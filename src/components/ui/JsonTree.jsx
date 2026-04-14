import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = (e) => {
    e.stopPropagation();
    const textToCopy = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <button 
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity ml-2 text-muted-foreground hover:text-foreground focus:outline-none"
      title="Copy value"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function JsonValue({ value }) {
  const type = typeof value;
  
  if (value === null) {
    return <span className="json-null font-mono">null</span>;
  }
  
  if (type === "string") {
    return <span className="json-string font-mono font-medium">"{value}"</span>;
  }
  
  if (type === "number") {
    return <span className="json-number font-mono font-medium">{value}</span>;
  }
  
  if (type === "boolean") {
    return <span className="json-boolean font-mono font-medium">{value ? "true" : "false"}</span>;
  }
  
  return <span className="text-foreground font-mono">{String(value)}</span>;
}

export function JsonTree({ data, name, depth = 0, isLast = true }) {
  const [expanded, setExpanded] = useState(depth < 2);
  
  const isArray = Array.isArray(data);
  const isObject = data !== null && typeof data === "object";
  
  if (!isObject) {
    return (
      <div className="group flex items-center gap-1.5 font-mono text-[13px] leading-relaxed py-0.5 w-max pr-4">
        {name && <span className="json-key">"{name}":</span>}
        <JsonValue value={data} />
        {!isLast && <span className="json-punctuation">,</span>}
        <CopyButton value={data} />
      </div>
    );
  }
  
  const keys = Object.keys(data);
  const isEmpty = keys.length === 0;
  
  const bracketOpen = isArray ? "[" : "{";
  const bracketClose = isArray ? "]" : "}";
  
  if (isEmpty) {
    return (
      <div className="group flex items-center gap-1.5 font-mono text-[13px] leading-relaxed py-0.5 w-max pr-4">
        {name && <span className="json-key">"{name}":</span>}
        <span className="json-punctuation">{bracketOpen}{bracketClose}</span>
        {!isLast && <span className="json-punctuation">,</span>}
        <CopyButton value={data} />
      </div>
    );
  }
  
  return (
    <div className="flex flex-col font-mono text-[13px] leading-relaxed">
      <div 
        className={cn(
          "group flex items-center gap-1.5 cursor-pointer hover:bg-accent/30 py-0.5 px-1 rounded transition-colors w-max pr-4",
          depth > 0 ? "-ml-4" : ""
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex h-3 w-3 items-center justify-center text-muted-foreground shrink-0">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </div>
        {name && <span className="json-key">"{name}":</span>}
        <span className="json-punctuation">{bracketOpen}</span>
        {!expanded && (
          <span className="text-muted-foreground italic text-[11px] ml-1">
            {isArray ? `${keys.length} items` : `${keys.length} keys`}
          </span>
        )}
        {!expanded && <span className="json-punctuation ml-1">{bracketClose}{!isLast && ","}</span>}
        <CopyButton value={data} />
      </div>
      
      {expanded && (
        <div className="flex flex-col border-l border-border/20 ml-[5px] pl-4">
          {keys.map((key, index) => (
            <JsonTree
              key={key}
              name={isArray ? null : key}
              data={data[key]}
              depth={depth + 1}
              isLast={index === keys.length - 1}
            />
          ))}
        </div>
      )}
      
      {expanded && (
        <div className="json-punctuation py-0.5">
          {bracketClose}
          {!isLast && <span className="json-punctuation">,</span>}
        </div>
      )}
    </div>
  );
}
