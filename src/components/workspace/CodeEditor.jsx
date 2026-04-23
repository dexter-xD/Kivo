import { useMemo, useRef } from "react";

import { cn } from "@/lib/utils.js";
import { isJsonText } from "@/lib/formatters.js";

const tokenPattern = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"\s*:|"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?|[{}\[\],:])/g;
const graphqlKeywords = new Set([
  "query",
  "mutation",
  "subscription",
  "fragment",
  "on",
  "true",
  "false",
  "null",
  "schema",
  "scalar",
  "type",
  "interface",
  "union",
  "enum",
  "input",
  "directive",
  "extend",
  "implements"
]);
const graphqlTokenPattern = /"""[\s\S]*?"""|"(?:\\.|[^"])*"|#[^\n]*|\.\.\.|@[A-Za-z_][A-Za-z0-9_]*|\$[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[!():=@\[\]{|},]/g;

function tokenClassName(token) {
  if (/^".*":$/.test(token)) {
    return "json-key";
  }

  if (/^"/.test(token)) {
    return "json-string";
  }

  if (/^(true|false)$/.test(token)) {
    return "json-boolean";
  }

  if (token === "null") {
    return "json-null";
  }

  if (/^-?\d/.test(token)) {
    return "json-number";
  }

  return "json-punctuation";
}

function renderHighlightedJson(text) {
  const content = text || "";
  const nodes = [];
  let lastIndex = 0;
  let match;

  tokenPattern.lastIndex = 0;

  while ((match = tokenPattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }

    const token = match[0];
    nodes.push(
      <span key={`${match.index}-${token}`} className={tokenClassName(token)}>
        {token}
      </span>
    );
    lastIndex = match.index + token.length;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes;
}

function graphqlTokenClassName(token) {
  if (token.startsWith("#")) {
    return "graphql-comment";
  }

  if (token.startsWith('"')) {
    return "graphql-string";
  }

  if (token.startsWith("$")) {
    return "graphql-variable";
  }

  if (token.startsWith("@")) {
    return "graphql-directive";
  }

  if (/^-?\d/.test(token)) {
    return "graphql-number";
  }

  if (graphqlKeywords.has(token)) {
    return "graphql-keyword";
  }

  if (/^\.{3}$|^[!():=@\[\]{|},]$/.test(token)) {
    return "graphql-punctuation";
  }

  return "graphql-field";
}

function renderHighlightedGraphql(text) {
  const content = text || "";
  const nodes = [];
  let lastIndex = 0;
  let match;

  graphqlTokenPattern.lastIndex = 0;

  while ((match = graphqlTokenPattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }

    const token = match[0];
    nodes.push(
      <span key={`${match.index}-${token}`} className={graphqlTokenClassName(token)}>
        {token}
      </span>
    );
    lastIndex = match.index + token.length;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes;
}

export function CodeEditor({
  value,
  onChange,
  placeholder,
  readOnly = false,
  language = "text",
  disabled = false,
  wrapLines = false,
  className
}) {
  const highlightRef = useRef(null);
  const isJson = language === "json" && isJsonText(value);
  const isGraphql = language === "graphql";
  const useOverlay = !readOnly && (language === "json" || language === "graphql");
  const displayValue = useMemo(() => value || "", [value]);

  function syncScroll(event) {
    if (!highlightRef.current) {
      return;
    }

    highlightRef.current.scrollTop = event.target.scrollTop;
    highlightRef.current.scrollLeft = event.target.scrollLeft;
  }

  if (readOnly) {
    return (
      <div className={cn("relative min-h-0 flex-1 overflow-hidden bg-background/20", className)}>
        <pre
          className={cn(
            "thin-scrollbar h-full px-4 py-3 font-mono text-[12px] leading-6 text-foreground",
            wrapLines ? "overflow-y-auto overflow-x-hidden whitespace-pre-wrap [overflow-wrap:anywhere]" : "overflow-auto"
          )}
        >
          <code>
            {language === "json" && isJson
              ? renderHighlightedJson(displayValue)
              : isGraphql
                ? renderHighlightedGraphql(displayValue)
                : displayValue}
          </code>
        </pre>
      </div>
    );
  }

  if (!useOverlay) {
    return (
      <textarea
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        className={cn(
          "thin-scrollbar h-full w-full resize-none overflow-auto border-0 bg-background/20 px-4 py-3 font-mono text-[12px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      />
    );
  }

  return (
    <div className={cn("relative min-h-0 flex-1 overflow-hidden bg-background/20", className)}>
      <pre
        ref={highlightRef}
        aria-hidden="true"
        className="pointer-events-none h-full overflow-auto px-4 py-3 font-mono text-[12px] leading-6 text-foreground"
      >
        <code>
          {displayValue
            ? isJson
              ? renderHighlightedJson(displayValue)
              : isGraphql
                ? renderHighlightedGraphql(displayValue)
                : displayValue
            : " "}
        </code>
      </pre>
      <textarea
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        className="thin-scrollbar absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent px-4 py-3 font-mono text-[12px] leading-6 text-transparent caret-foreground outline-none placeholder:text-muted-foreground/0 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {!value ? <div className="pointer-events-none absolute left-4 top-3 font-mono text-[12px] text-muted-foreground/60">{placeholder}</div> : null}
    </div>
  );
}
