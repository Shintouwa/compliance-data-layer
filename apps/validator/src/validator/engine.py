"""🔒 HUMAN-OWNED — architecture.md Part I §1.8, CLAUDE.md §4.3.

Schematron execution and rule interpretation. The ONLY file that imports
saxonche (§1.8(4)).

What this engine is
-------------------
A direct interpreter for the ISO Schematron subset our own rulesets use. It
walks patterns and rules with lxml and evaluates every `@context`, `@test` and
`cdl:value-xpath` through SaxonC's XPath 3.1 processor.

Why an interpreter rather than the ISO skeleton XSLT pipeline: the skeleton
(`iso_dsdl_include.xsl` -> `iso_abstract_expand.xsl` -> `iso_svrl_for_xslt2.xsl`)
is three XSLT transforms deep and its failure mode is a rule that silently
produces no SVRL output. Here, anything the engine cannot account for raises.

The loudness contract
---------------------
Every construct this engine does not implement raises
`SchematronUnsupportedError` at LOAD time, not at validation time. Every rule
whose XPath does not compile raises `SchematronCompileError` at load time.

That matters more than it looks. A validator that silently skips a rule reports
invoices as passing when they will not — the company-ending wrong answer of
Part I §1.1. A validator that refuses to start is a crash, which is harmless.

Expect `SchematronUnsupportedError` the first time a published PINT AE or
EN 16931 Schematron is dropped into `specs/`: those use `sch:include`, abstract
patterns and `sch:phase`. That is a real and scheduled piece of work, not a bug
to route around by making the engine tolerant.

The redaction boundary
----------------------
`cdl:value-xpath` yields the offending value. It is passed straight into
`redaction.derive_value_shape()` and bound to nothing else — no local it
outlives, no log line, no exception message. This function is the last place in
the system where a raw client value exists.
"""

from __future__ import annotations

import atexit
import gc
import hashlib
import queue
import re
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final, TypeVar

from lxml import etree
from saxonche import PySaxonApiError, PySaxonProcessor, PyXPathProcessor

from .codelists import codelist_source_bytes, load_codelist
from .errors import (
    EngineFailureError,
    ParseError,
    SchematronCompileError,
    SchematronUnsupportedError,
)
from .models import FailureClass, Finding, Severity
from .redaction import build_message, derive_value_shape

__all__ = [
    "CDL_NS",
    "CompiledRule",
    "CompiledRuleset",
    "SCH_NS",
    "SchematronEngine",
    "compile_ruleset",
    "get_engine",
]

SCH_NS: Final = "http://purl.oclc.org/dsdl/schematron"
CDL_NS: Final = "https://compliance-data-layer.dev/schematron-extensions/v1"

_SCH: Final = f"{{{SCH_NS}}}"
_CDL: Final = f"{{{CDL_NS}}}"

# Constructs that change which rules fire. Encountering one means our reading of
# the ruleset is incomplete, so we refuse the whole ruleset.
_UNSUPPORTED_ELEMENTS: Final[dict[str, str]] = {
    f"{_SCH}include": "sch:include (inline the included fragment, or extend this engine)",
    f"{_SCH}extends": "sch:extends (abstract rule inheritance)",
    f"{_SCH}phase": "sch:phase (active-pattern selection)",
    f"{_SCH}diagnostics": "sch:diagnostics",
    f"{_SCH}param": "sch:param (abstract pattern parameters)",
}

# Written out literally rather than derived with typing.get_args so that mypy
# checks the members against the Literal unions in models.py. If someone adds an
# eleventh FailureClass there and forgets this tuple, that is a type error here
# rather than a rule that loads with an unclassifiable finding.
_SEVERITIES: Final[tuple[Severity, ...]] = ("fatal", "error", "warning")

_FAILURE_CLASSES: Final[tuple[FailureClass, ...]] = (
    "missing_mandatory",
    "invalid_code",
    "format_mismatch",
    "arithmetic_mismatch",
    "identifier_invalid",
    "cardinality",
    "cross_field_dependency",
    "encoding",
    "date_logic",
    "rounding",
)

_CODELIST_TOKEN: Final = "$CODELIST"

# Q{uri}local -> prefix:local, for the `xpath` field on a finding.
_QNAME_RE: Final = re.compile(r"Q\{([^}]*)\}([^/\[\]]+)")

_T = TypeVar("_T")


@dataclass(frozen=True, slots=True)
class CompiledRule:
    """One `sch:assert` or `sch:report`, ready to evaluate."""

    rule_id: str
    native_rule_code: str | None
    severity: Severity
    business_term: str | None
    failure_class: FailureClass | None
    test: str
    is_report: bool
    value_xpath: str | None
    expected: str | None
    expected_description: str
    assert_text: str


@dataclass(frozen=True, slots=True)
class CompiledRuleContext:
    context_expr: str
    rules: tuple[CompiledRule, ...]


@dataclass(frozen=True, slots=True)
class CompiledPattern:
    pattern_id: str
    contexts: tuple[CompiledRuleContext, ...]


@dataclass(frozen=True, slots=True)
class CompiledRuleset:
    spec_id: str
    ruleset_hash: str
    namespaces: tuple[tuple[str, str], ...]
    patterns: tuple[CompiledPattern, ...]

    @property
    def rule_ids(self) -> tuple[str, ...]:
        return tuple(
            rule.rule_id
            for pattern in self.patterns
            for ctx in pattern.contexts
            for rule in ctx.rules
        )


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SchematronUnsupportedError(message)


def _required_attr(element: etree._Element, name: str, source: str) -> str:
    """Fetch an attribute that the ruleset must carry, or refuse the ruleset."""
    value = element.get(name)
    if not value:
        raise SchematronUnsupportedError(
            f"{source}: <{etree.QName(element).localname}> requires a non-empty "
            f"@{name}."
        )
    return value


def _narrow_severity(value: str, rule_id: str, source: str) -> Severity:
    for candidate in _SEVERITIES:
        if candidate == value:
            return candidate
    raise SchematronUnsupportedError(
        f"{source}: {rule_id} has @flag={value!r}; expected one of "
        f"{list(_SEVERITIES)}."
    )


def _narrow_failure_class(
    value: str | None, rule_id: str, source: str
) -> FailureClass | None:
    if value is None:
        return None
    for candidate in _FAILURE_CLASSES:
        if candidate == value:
            return candidate
    raise SchematronUnsupportedError(
        f"{source}: {rule_id} has cdl:failure-class={value!r}, which is not one "
        f"of the ten FailureClass values in architecture.md Part I §2.3. The "
        f"corpus asserts on classification, not just detection."
    )


def _substitute_lets(expr: str, lets: dict[str, str]) -> str:
    """Inline `sch:let` bindings textually.

    SaxonC clears externally-declared variables between evaluations, and a rule
    that quietly lost its variable would stop firing with no error at all.
    Substitution keeps the compiled test self-contained and hashable.
    """
    for name, value in lets.items():
        expr = re.sub(rf"\${re.escape(name)}\b", f"({value})", expr)
    return expr


def _compile_assertion(
    element: etree._Element,
    lets: dict[str, str],
    source_name: str,
) -> CompiledRule:
    is_report = etree.QName(element).localname == "report"
    if not element.get("id"):
        raise SchematronUnsupportedError(
            f"{source_name}: every sch:assert and sch:report must carry @id. "
            f"The corpus asserts on the SET OF RULE IDS returned (§3.3); an "
            f"anonymous assertion cannot be asserted on, so it cannot be "
            f"trusted to have fired."
        )
    rule_id = _required_attr(element, "id", source_name)
    test = _required_attr(element, "test", source_name)
    severity = _narrow_severity(element.get("flag", "error"), rule_id, source_name)
    failure_class = _narrow_failure_class(
        element.get(f"{_CDL}failure-class"), rule_id, source_name
    )

    codelist_id = element.get(f"{_CDL}codelist")
    if codelist_id is not None:
        codelist = load_codelist(codelist_id)
        if severity in ("fatal", "error"):
            # A partial list cannot deny membership. Refuses at LOAD time.
            codelist.assert_may_deny(rule_id)
        test = test.replace(_CODELIST_TOKEN, codelist.xpath_sequence())

    expected_description = element.get(f"{_CDL}expected-description")
    if not expected_description:
        raise SchematronUnsupportedError(
            f"{source_name}: {rule_id} has no cdl:expected-description. The "
            f"finding message is templated from it (Part I §2.9 layer 2); "
            f"without it the only way to describe the failure is to quote the "
            f"offending value."
        )

    # itertext() is typed as yielding str | bytes: comments and processing
    # instructions inside an assert would come back as bytes. Only the text is
    # rule prose.
    text = "".join(part for part in element.itertext() if isinstance(part, str)).strip()

    return CompiledRule(
        rule_id=rule_id,
        native_rule_code=element.get(f"{_CDL}native-code"),
        severity=severity,
        business_term=element.get(f"{_CDL}business-term"),
        failure_class=failure_class,
        test=_substitute_lets(test, lets),
        is_report=is_report,
        value_xpath=_substitute_lets(element.get(f"{_CDL}value-xpath", ""), lets) or None,
        expected=element.get(f"{_CDL}expected"),
        expected_description=expected_description,
        assert_text=text,
    )


def _context_to_expression(context: str) -> str:
    """Approximate an XSLT match pattern as an XPath expression.

    `cac:InvoiceLine` as a match pattern means "any element so named"; as an
    XPath expression it means "a child of the context node". Wrapping in `//(…)`
    reconciles the two for the pattern forms our rulesets use.

    This is an APPROXIMATION and is why `_UNSUPPORTED_ELEMENTS` exists: a
    published Schematron using axes or predicates in a match pattern may not
    round-trip through it. Such a ruleset must be reviewed, not assumed.
    """
    context = context.strip()
    if context.startswith("/"):
        return context
    return f"//({context})"


def _load_schematron(path: Path) -> tuple[list[tuple[str, str]], list[CompiledPattern]]:
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
    try:
        root = etree.parse(str(path), parser=parser).getroot()
    except etree.XMLSyntaxError as exc:
        raise SchematronCompileError(f"{path.name}: not well-formed XML: {exc}") from exc

    _require(
        etree.QName(root).localname == "schema" and etree.QName(root).namespace == SCH_NS,
        f"{path.name}: root element must be {{{SCH_NS}}}schema.",
    )

    binding = root.get("queryBinding", "").lower()
    _require(
        binding in ("xslt2", "xslt3"),
        f"{path.name}: queryBinding={binding!r}. This engine evaluates XPath 3.1 "
        f"via SaxonC and supports queryBinding 'xslt2' or 'xslt3' only. XPath 1.0 "
        f"rulesets have different numeric and string semantics and would produce "
        f"different — silently different — results.",
    )

    for element in root.iter():
        tag = element.tag
        if isinstance(tag, str) and tag in _UNSUPPORTED_ELEMENTS:
            raise SchematronUnsupportedError(
                f"{path.name}: unsupported construct {_UNSUPPORTED_ELEMENTS[tag]}. "
                f"Refusing the ruleset rather than skipping the construct — a "
                f"skipped construct is a rule that never fires. "
                f"architecture.md Part I §1.1."
            )

    namespaces: list[tuple[str, str]] = []
    for ns_el in root.findall(f"{_SCH}ns"):
        namespaces.append(
            (
                _required_attr(ns_el, "prefix", path.name),
                _required_attr(ns_el, "uri", path.name),
            )
        )

    patterns: list[CompiledPattern] = []
    for pattern_el in root.findall(f"{_SCH}pattern"):
        _require(
            pattern_el.get("abstract") != "true",
            f"{path.name}: abstract patterns are not supported.",
        )
        pattern_id = pattern_el.get("id") or f"pattern-{len(patterns)}"

        contexts: list[CompiledRuleContext] = []
        for rule_el in pattern_el.findall(f"{_SCH}rule"):
            _require(
                rule_el.get("abstract") != "true",
                f"{path.name}: abstract rules are not supported.",
            )
            context = _required_attr(rule_el, "context", path.name)

            lets: dict[str, str] = {}
            for let_el in rule_el.findall(f"{_SCH}let"):
                lets[_required_attr(let_el, "name", path.name)] = _required_attr(
                    let_el, "value", path.name
                )

            assertions = [
                _compile_assertion(el, lets, path.name)
                for el in rule_el
                if isinstance(el.tag, str)
                and el.tag in (f"{_SCH}assert", f"{_SCH}report")
            ]
            if assertions:
                contexts.append(
                    CompiledRuleContext(
                        context_expr=_context_to_expression(context),
                        rules=tuple(assertions),
                    )
                )

        if contexts:
            patterns.append(CompiledPattern(pattern_id=pattern_id, contexts=tuple(contexts)))

    return namespaces, patterns


def compile_ruleset(
    spec_id: str,
    schematron_paths: list[Path],
    codelist_ids: list[str],
) -> CompiledRuleset:
    """Load and compile a ruleset, and derive its reproducible hash.

    `ruleset_hash` covers the Schematron sources AND every code list, because
    code lists are inlined into compiled tests — changing one changes results.
    Without that, a validation outcome would not be reproducible from the hash,
    and Part I §2.9 makes the hash the thing that makes results replayable.
    """
    namespaces: list[tuple[str, str]] = []
    patterns: list[CompiledPattern] = []
    digest = hashlib.sha256()

    for path in sorted(schematron_paths):
        if not path.is_file():
            raise SchematronCompileError(
                f"Ruleset file not found: {path}. The registry declares it, so "
                f"validating without it would silently apply a partial ruleset."
            )
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
        file_ns, file_patterns = _load_schematron(path)
        for prefix, uri in file_ns:
            if (prefix, uri) not in namespaces:
                namespaces.append((prefix, uri))
        patterns.extend(file_patterns)

    for list_id in sorted(codelist_ids):
        digest.update(list_id.encode("utf-8"))
        digest.update(codelist_source_bytes(list_id))

    seen: set[str] = set()
    for pattern in patterns:
        for ctx in pattern.contexts:
            for rule in ctx.rules:
                if rule.rule_id in seen:
                    raise SchematronCompileError(
                        f"Duplicate rule id {rule.rule_id!r} in ruleset {spec_id!r}. "
                        f"The corpus asserts on rule-ID sets; duplicates make an "
                        f"assertion ambiguous."
                    )
                seen.add(rule.rule_id)

    return CompiledRuleset(
        spec_id=spec_id,
        ruleset_hash=f"sha256:{digest.hexdigest()}",
        namespaces=tuple(namespaces),
        patterns=tuple(patterns),
    )


def _readable_xpath(saxon_path: str, namespaces: tuple[tuple[str, str], ...]) -> str:
    """Rewrite Saxon's Q{uri}local path into prefix:local form."""
    by_uri = {uri: prefix for prefix, uri in namespaces}

    def replace(match: re.Match[str]) -> str:
        uri, local = match.group(1), match.group(2)
        prefix = by_uri.get(uri)
        return f"{prefix}:{local}" if prefix else local

    return _QNAME_RE.sub(replace, saxon_path)


class SchematronEngine:
    """Owns the Saxon processor and the ONE thread allowed to touch it.

    SaxonC-HE is a GraalVM native image. Its isolate has thread affinity: the
    processor must be created and used on the same OS thread. Touching it from
    another thread does not raise a Python exception — it aborts the process
    with

        Fatal error: StackOverflowError: ... the wrong JNI environment or the
        wrong IsolateThread

    which is a hard crash of the whole dyno, not a failed request.

    This matters in production, not just in tests: FastAPI runs `def` (sync)
    endpoints in a thread pool, so consecutive requests arrive on DIFFERENT
    threads. A plain mutex serialises access but does nothing about affinity,
    and would leave the crash in place while looking like it had been handled.

    So: one dedicated worker thread, created here, owning the processor for the
    process lifetime. Every Saxon call is marshalled onto it. Serialisation
    falls out of the single worker for free.

    Throughput past one document at a time is a horizontal-scaling question —
    the sidecar is stateless by construction (Part III §5), so the answer is
    more dynos, not more isolates. Each isolate carries tens of megabytes; one
    per pool thread would exhaust a Heroku dyno.

    See `shutdown` for why this is a hand-rolled daemon thread rather than a
    ThreadPoolExecutor.
    """

    _processor: PySaxonProcessor | None

    def __init__(self) -> None:
        self._queue: queue.Queue[Callable[[], None] | None] = queue.Queue()
        self._alive = True
        # DAEMON, deliberately. A ThreadPoolExecutor is the obvious choice here
        # and it is the wrong one: concurrent.futures registers its cleanup
        # through threading._register_atexit, which runs BEFORE atexit handlers
        # and joins the pool's threads. By the time our atexit shutdown fires,
        # the worker is already gone, the drop below never happens, and the
        # process aborts anyway. A daemon thread is not joined by
        # threading._shutdown, so it is still alive when atexit runs.
        self._thread = threading.Thread(
            target=self._run, name="saxon-isolate", daemon=True
        )
        self._thread.start()

        self._processor = self._call(lambda: PySaxonProcessor(license=False))
        self._saxon_version = self._call(lambda: self._saxon.version)
        atexit.register(self.shutdown)

    def _run(self) -> None:
        while True:
            task = self._queue.get()
            if task is None:
                return
            task()

    def _call(self, work: Callable[[], _T]) -> _T:
        """Run `work` on the Saxon thread and return its result here."""
        if not self._alive:
            raise EngineFailureError(str(uuid.uuid4()), "engine has been shut down")

        results: list[_T] = []
        errors: list[BaseException] = []
        done = threading.Event()

        def task() -> None:
            try:
                results.append(work())
            except BaseException as exc:  # noqa: BLE001 — re-raised on the caller
                errors.append(exc)
            finally:
                done.set()

        self._queue.put(task)
        done.wait()
        if errors:
            raise errors[0]
        return results[0]

    @property
    def _saxon(self) -> PySaxonProcessor:
        processor = self._processor
        if processor is None:
            raise EngineFailureError(str(uuid.uuid4()), "engine has been shut down")
        return processor

    @property
    def saxon_version(self) -> str:
        return self._saxon_version

    def shutdown(self) -> None:
        """Drop the processor ON THE THREAD THAT CREATED IT, then retire it.

        This is not tidiness — it is the difference between a clean exit and

            Fatal error: StackOverflowError: ... the wrong IsolateThread

        printed over the test summary. The GraalVM isolate must be finalised by
        its owning thread. Left to the garbage collector, `PySaxonProcessor` is
        finalised on whichever thread happens to be running at interpreter
        teardown (in practice the main thread), which aborts the process.

        Note it drops the last REFERENCE rather than calling `__exit__`:
        `__exit__` tears the isolate down and the object is then finalised
        again, which is a double release and aborts just the same.

        Verified empirically: dropping on the Saxon thread exits 0; dropping on
        the main thread, or not dropping at all, aborts.
        """
        if not self._alive:
            return

        def drop() -> None:
            self._processor = None
            gc.collect()

        self._call(drop)
        self._alive = False
        self._queue.put(None)
        self._thread.join(timeout=10)

    def _new_xpath(self, namespaces: tuple[tuple[str, str], ...]) -> PyXPathProcessor:
        xpath = self._saxon.new_xpath_processor()
        for prefix, uri in namespaces:
            xpath.declare_namespace(prefix, uri)
        return xpath

    def validate(
        self,
        document: bytes,
        ruleset: CompiledRuleset,
        *,
        include_warnings: bool = True,
        stop_on_first_error: bool = False,
    ) -> list[Finding]:
        return self._call(
            lambda: self._validate_on_saxon_thread(
                document, ruleset, include_warnings, stop_on_first_error
            )
        )

    def _validate_on_saxon_thread(
        self,
        document: bytes,
        ruleset: CompiledRuleset,
        include_warnings: bool,
        stop_on_first_error: bool,
    ) -> list[Finding]:
        # Parse with lxml first: it gives a precise line/column for the 422
        # body, which Saxon's error string does not.
        try:
            etree.fromstring(
                document,
                parser=etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False),
            )
        except etree.XMLSyntaxError as exc:
            line, column = exc.position if exc.position else (0, 0)
            raise ParseError(line=line, column=column) from exc

        text = document.decode("utf-8", errors="strict")
        try:
            root_node = self._saxon.parse_xml(xml_text=text)
        except PySaxonApiError as exc:
            raise EngineFailureError(str(uuid.uuid4()), f"parse_xml failed: {exc}") from exc

        findings: list[Finding] = []

        for pattern in ruleset.patterns:
            claimed: set[str] = set()

            for ctx in pattern.contexts:
                doc_xpath = self._new_xpath(ruleset.namespaces)
                doc_xpath.set_context(xdm_item=root_node)
                try:
                    matched = doc_xpath.evaluate(ctx.context_expr)
                except PySaxonApiError as exc:
                    raise SchematronCompileError(
                        f"context {ctx.context_expr!r} did not evaluate: {exc}"
                    ) from exc

                if matched is None:
                    continue

                for index in range(matched.size):
                    item = matched.item_at(index)
                    node_xpath = self._new_xpath(ruleset.namespaces)
                    node_xpath.set_context(xdm_item=item)

                    location_item = node_xpath.evaluate_single("path()")
                    location = location_item.get_string_value() if location_item else ""
                    if location in claimed:
                        # ISO Schematron: within one pattern, the first matching
                        # rule claims the node.
                        continue
                    claimed.add(location)

                    readable = _readable_xpath(location, ruleset.namespaces)

                    for rule in ctx.rules:
                        finding = self._evaluate_rule(node_xpath, rule, readable)
                        if finding is None:
                            continue
                        if finding.severity == "warning" and not include_warnings:
                            continue
                        findings.append(finding)
                        if stop_on_first_error and finding.severity in ("fatal", "error"):
                            return findings

        return findings

    def _evaluate_rule(
        self,
        node_xpath: PyXPathProcessor,
        rule: CompiledRule,
        location: str,
    ) -> Finding | None:
        try:
            holds = node_xpath.effective_boolean_value(rule.test)
        except PySaxonApiError as exc:
            # Load-time compilation catches syntax; this catches a test that only
            # fails against certain documents (e.g. a cast that cannot succeed).
            # Still loud: an unevaluatable rule is a rule with no verdict.
            raise SchematronCompileError(
                f"{rule.rule_id}: test {rule.test!r} did not evaluate at "
                f"{location}: {exc}"
            ) from exc

        fired = holds if rule.is_report else not holds
        if not fired:
            return None

        # --- the redaction boundary -------------------------------------------
        # `raw` is the only client value in this process. It goes into
        # derive_value_shape and nowhere else: not a local that outlives this
        # block, not a log line, not an exception message.
        raw: str | None = None
        if rule.value_xpath is not None:
            try:
                item = node_xpath.evaluate_single(f"string({rule.value_xpath})")
            except PySaxonApiError as exc:
                raise SchematronCompileError(
                    f"{rule.rule_id}: cdl:value-xpath {rule.value_xpath!r} did not "
                    f"evaluate: {exc}"
                ) from exc
            raw = item.get_string_value() if item is not None else None
            if raw == "" and not self._node_exists(node_xpath, rule.value_xpath):
                # Distinguish "element absent" from "element present but blank":
                # different conformance failures, different remediations.
                raw = None

        shape = derive_value_shape(raw, rule.expected)
        del raw
        message = build_message(rule.expected_description, shape)
        # ----------------------------------------------------------------------

        return Finding(
            rule_id=rule.rule_id,
            native_rule_code=rule.native_rule_code,
            severity=rule.severity,
            business_term=rule.business_term,
            xpath=location,
            failure_class=rule.failure_class,
            message=message,
            value_shape=shape,
        )

    @staticmethod
    def _node_exists(node_xpath: PyXPathProcessor, expr: str) -> bool:
        try:
            return node_xpath.effective_boolean_value(f"exists({expr})")
        except PySaxonApiError:
            return False


_engine: SchematronEngine | None = None
_engine_lock: Final = threading.Lock()


def get_engine() -> SchematronEngine:
    """Process-wide engine. Constructing a PySaxonProcessor is expensive."""
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                _engine = SchematronEngine()
    return _engine
