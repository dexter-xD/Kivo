import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button.jsx";
import { EnvHighlightInput } from "@/components/ui/EnvHighlightInput.jsx";
import { cancelOAuthExchange, exchangeOAuthToken } from "@/lib/http-client.js";
import {
  buildAuthorizationUrl,
  createOAuthRow,
  extractAuthorizationCode,
  generateOAuthStateToken,
  getOAuthValidationErrors,
  getOAuthWarnings,
  oauthClientAuthMethodOptions,
  oauthGrantOptions,
} from "@/lib/oauth.js";
import { cn } from "@/lib/utils.js";

function resolveEnvValue(text, envVars) {
  const merged = envVars?.merged ?? {};
  return String(text ?? "").replace(/\{\{([^}]+)\}\}/g, (_, key) => merged[key.trim()] ?? "");
}

function SectionShell({ icon: Icon, title, subtitle, children, className }) {
  return (
    <section className={cn("bg-transparent px-0 py-2", className)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 items-center justify-center text-primary">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold tracking-tight text-foreground">{title}</div>
          {subtitle ? <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{subtitle}</div> : null}
        </div>
      </div>
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}

function CompactSelect({ value, onChange, options, className }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    function handlePointer(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 w-full items-center justify-between border border-border/35 bg-background/30 px-3 text-left text-[12px] text-foreground outline-none transition-colors hover:bg-background/45 focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+4px)] z-30 min-w-full overflow-hidden border border-border/45 bg-popover">
          {options.map((option) => {
            const active = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-[12px] transition-colors",
                  active ? "bg-secondary/55 text-foreground" : "text-muted-foreground hover:bg-secondary/30 hover:text-foreground"
                )}
              >
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  envVars,
  placeholder,
  secret = false,
  actions = null,
  hint = "",
  layout = "stacked",
}) {
  const [showSecret, setShowSecret] = useState(false);
  const isStacked = layout === "stacked";

  return (
    <div className={cn("grid gap-1.5", isStacked ? "" : "sm:grid-cols-[156px_minmax(0,1fr)] sm:items-center sm:gap-3")}>
      <label className={cn("text-[12px] font-medium text-foreground/90", isStacked ? "" : "sm:pr-2")}>{label}</label>
      <div className="min-w-0">
        <div className="relative">
          <EnvHighlightInput
            value={value}
            onValueChange={onChange}
            envVars={envVars}
            placeholder={placeholder}
            type={secret && !showSecret ? "password" : "text"}
            inputClassName={cn(secret || actions ? "pr-16" : "")}
          />
          {(actions || secret) ? (
            <div className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1">
              {actions}
              {secret ? (
                <button
                  type="button"
                  onClick={() => setShowSecret((current) => !current)}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                >
                  {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
      </div>
    </div>
  );
}

function FormRow({ label, children, hint = "" }) {
  return (
    <div className="grid gap-1.5">
      <div className="text-[12px] font-medium text-foreground/90">{label}</div>
      <div className="min-w-0">
        {children}
        {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
      </div>
    </div>
  );
}

function DividerLabel({ label }) {
  return (
    <div className="pt-1">
      <div className="border-t border-border/12" />
      <div className="pt-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
    </div>
  );
}

function NoticeStack({ validationErrors, warnings, responseWarnings, notice, error }) {
  const items = [];

  if (error) {
    items.push({ key: "error", title: "OAuth error", tone: "danger", messages: [error], icon: XCircle });
  }

  if (validationErrors.length) {
    items.push({
      key: "validation",
      title: "Validation",
      tone: "danger",
      messages: validationErrors.slice(0, 3),
      icon: XCircle,
    });
  }

  if (warnings.length) {
    items.push({
      key: "warning",
      title: "Configuration warning",
      tone: "warning",
      messages: warnings.slice(0, 3),
      icon: AlertTriangle,
    });
  }

  if (responseWarnings.length) {
    items.push({
      key: "response",
      title: "Last response warning",
      tone: "warning",
      messages: responseWarnings,
      icon: ShieldAlert,
    });
  }

  if (notice) {
    items.push({ key: "notice", title: "OAuth status", tone: "success", messages: [notice], icon: CheckCircle2 });
  }

  if (!items.length) return null;

  return (
    <div className="grid gap-2">
      {items.map((item) => {
        const toneClass =
          item.tone === "danger"
            ? "border-danger/20 text-danger"
            : item.tone === "success"
              ? "border-success/20 text-success"
              : "border-warning/20 text-warning";
        const toneBg =
          item.tone === "danger"
            ? "hsl(var(--danger) / 0.08)"
            : item.tone === "success"
              ? "hsl(var(--success) / 0.08)"
              : "hsl(var(--warning) / 0.08)";
        const Icon = item.icon;

        return (
          <div key={item.key} className={cn("border px-3 py-2.5", toneClass)} style={{ backgroundColor: toneBg }}>
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] font-medium">{item.title}</div>
                <div className="mt-1 grid gap-1 text-[11px] leading-5">
                  {item.messages.map((message) => (
                    <div key={message}>{message}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TokenStatus({ oauth }) {
  const hasToken = Boolean(oauth.accessToken);

  return (
    <div className="flex items-center justify-between gap-2 border border-border/12 bg-transparent px-3 py-2">
      <div className="text-[12px] text-foreground">
        {hasToken ? `${oauth.tokenType || "Bearer"} token found` : "No token found"}
      </div>
      {hasToken ? <div className="text-[11px] text-muted-foreground">{oauth.expiresAt ? `Expires ${oauth.expiresAt}` : "Stored"}</div> : null}
    </div>
  );
}

function CodeExchangeModal({ open, oauth, envVars, onClose, onApplyCode }) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) {
      setValue(oauth.authorizationCode ?? "");
    }
  }, [open, oauth.authorizationCode]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 p-5 backdrop-blur-sm">
      <div className="panel-surface w-full max-w-2xl bg-card/96">
        <div className="flex items-center justify-between border-b border-border/18 px-4 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">OAuth helper</div>
            <div className="mt-1 text-[15px] font-semibold text-foreground">Paste callback URL or code</div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground transition-colors hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 px-4 py-4">
          <div className="grid gap-1">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Expected redirect URL</div>
            <div className="border border-border/18 bg-background/20 px-3 py-2 font-mono text-[12px] text-foreground">
              {resolveEnvValue(oauth.callbackUrl, envVars) || "Set a callback URL first"}
            </div>
          </div>
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste the full redirected URL or only the authorization code"
            className="thin-scrollbar min-h-[140px] resize-none border border-border/25 bg-background/20 p-3 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              onClick={() => {
                onApplyCode(extractAuthorizationCode(value));
                onClose();
              }}
            >
              Apply Code
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OAuth2Panel({
  auth,
  onChange,
  envVars,
  workspaceName,
  collectionName,
  onPersist,
  response,
  scopeLabel = "request",
}) {
  const oauth = auth?.oauth2 ?? {};
  const [isExchanging, setIsExchanging] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [feedbackNonce, setFeedbackNonce] = useState(0);
  const hasMountedResponseRef = useRef(false);
  const lastToastNonceRef = useRef(0);
  const activeExchangeIdRef = useRef("");

  const warnings = useMemo(() => getOAuthWarnings(auth), [auth]);
  const validationErrors = useMemo(() => getOAuthValidationErrors(auth), [auth]);
  const responseWarnings = useMemo(() => {
    if (!response || ![401, 403].includes(response.status)) return [];
    return ["The last response was unauthorized. Your token may be missing, expired, or scoped incorrectly."];
  }, [response]);

  useEffect(() => {
    if (!hasMountedResponseRef.current) {
      hasMountedResponseRef.current = true;
      return;
    }

    setFeedbackNonce((value) => value + 1);
  }, [response?.savedAt]);

  useEffect(() => {
    if (!feedbackNonce) return;
    if (lastToastNonceRef.current === feedbackNonce) return;

    let nextTone = "";
    let nextMessage = "";

    if (error) {
      nextTone = "danger";
      nextMessage = error;
    } else if (validationErrors.length) {
      nextTone = "danger";
      nextMessage = validationErrors[0];
    } else if (warnings.length) {
      nextTone = "warning";
      nextMessage = warnings[0];
    } else if (responseWarnings.length) {
      nextTone = "warning";
      nextMessage = responseWarnings[0];
    } else if (notice) {
      nextTone = "success";
      nextMessage = notice;
    }

    if (!nextMessage) return;

    lastToastNonceRef.current = feedbackNonce;

    const toastOptions = {
      id: "oauth-panel-feedback",
      duration: 5200,
    };

    if (nextTone === "danger") {
      toast.error(nextMessage, toastOptions);
    } else if (nextTone === "warning") {
      toast.warning(nextMessage, toastOptions);
    } else {
      toast.success(nextMessage, toastOptions);
    }
  }, [feedbackNonce, error, validationErrors, warnings, responseWarnings, notice]);

  function normalizeOAuthPatch(patch) {
    const trimKeys = new Set([
      "authUrl",
      "tokenUrl",
      "callbackUrl",
      "clientId",
      "clientSecret",
      "scope",
      "audience",
      "resource",
      "authorizationCode",
      "refreshToken",
      "tokenType",
      "username",
      "state",
      "codeVerifier",
      "clientAuthMethod",
    ]);

    return Object.fromEntries(
      Object.entries(patch).map(([key, value]) => {
        if (typeof value === "string" && trimKeys.has(key)) {
          return [key, value.trim()];
        }
        return [key, value];
      })
    );
  }

  const updateOAuth = (patch) => {
    const normalizedPatch = normalizeOAuthPatch(patch);
    onChange({ ...auth, type: "oauth2", oauth2: { ...oauth, ...normalizedPatch } });
  };

  async function persistAndNotify(nextPatch, message) {
    const normalizedPatch = normalizeOAuthPatch(nextPatch);
    const nextAuth = { ...auth, type: "oauth2", oauth2: { ...oauth, ...normalizedPatch } };
    onChange(nextAuth);
    if (onPersist) {
      await onPersist(nextAuth);
    }
    setNotice(message);
    setError("");
    setFeedbackNonce((value) => value + 1);
  }

  async function handleOpenAuthorizationPage() {
    try {
      setError("");
      const nextState = oauth.state || generateOAuthStateToken();
      const { url, codeVerifier } = await buildAuthorizationUrl(
        { ...oauth, state: nextState },
        (value) => resolveEnvValue(value, envVars)
      );

      await persistAndNotify(
        {
          state: nextState,
          codeVerifier: oauth.usePkce ? codeVerifier : oauth.codeVerifier,
          lastStatus: "authorization-opened",
          lastWarning: "",
          lastError: "",
        },
        "Browser opened. Finish sign-in, then paste the callback URL or code."
      );

      await openUrl(url);
      setShowCodeModal(true);
    } catch (nextError) {
      const message = nextError?.message || "Failed to open the authorization page.";
      updateOAuth({ lastError: message, lastStatus: "authorization-open-failed" });
      setError(message);
      setNotice("");
      setFeedbackNonce((value) => value + 1);
    }
  }

  async function handleExchange(grantTypeOverride = oauth.grantType) {
    const requestId = `oauth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    activeExchangeIdRef.current = requestId;
    setIsExchanging(true);
    setError("");
    setNotice("");

    try {
      const result = await exchangeOAuthToken({
        workspaceName: workspaceName || "",
        collectionName: collectionName || "",
        requestId,
        oauth: {
          ...oauth,
          grantType: grantTypeOverride,
          authorizationCode: extractAuthorizationCode(oauth.authorizationCode),
        },
      });

      if (activeExchangeIdRef.current !== requestId) {
        return;
      }

      await persistAndNotify(
        {
          grantType: grantTypeOverride,
          authorizationCode: extractAuthorizationCode(oauth.authorizationCode),
          accessToken: result.accessToken ?? "",
          refreshToken: result.refreshToken || oauth.refreshToken || "",
          tokenType: result.tokenType || "Bearer",
          expiresAt: result.expiresAt || "",
          scope: result.scope || oauth.scope || "",
          lastStatus: "token-ready",
          lastError: "",
          lastWarning: "",
        },
        "Token saved and ready for this auth config."
      );
    } catch (nextError) {
      if (activeExchangeIdRef.current !== requestId) {
        return;
      }

      const message = nextError?.toString?.() || "OAuth token exchange failed.";
      updateOAuth({ lastError: message, lastStatus: "token-error" });
      setError(message);
      setFeedbackNonce((value) => value + 1);
    } finally {
      if (activeExchangeIdRef.current === requestId) {
        activeExchangeIdRef.current = "";
        setIsExchanging(false);
      }
    }
  }

  async function handleCancelExchange() {
    const requestId = activeExchangeIdRef.current;
    if (!requestId) {
      setIsExchanging(false);
      return;
    }

    activeExchangeIdRef.current = "";
    setIsExchanging(false);

    try {
      await cancelOAuthExchange(requestId);
      updateOAuth({ lastStatus: "token-cancelled", lastError: "", lastWarning: "" });
      setError("");
      setNotice("Token request cancelled.");
      setFeedbackNonce((value) => value + 1);
    } catch {
      setNotice("");
      setError("Failed to cancel token request.");
      setFeedbackNonce((value) => value + 1);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-transparent text-[12px] text-muted-foreground">
      <CodeExchangeModal
        open={showCodeModal}
        oauth={oauth}
        envVars={envVars}
        onClose={() => setShowCodeModal(false)}
        onApplyCode={(code) => updateOAuth({ authorizationCode: code })}
      />
      <div className="thin-scrollbar min-h-0 flex-1 overflow-auto">
        <div className="mx-auto grid max-w-[920px] gap-3 px-4 py-3.5">
          <FormRow
            label={(
              <span className="inline-flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 text-primary" />
                Grant Type
              </span>
            )}
          >
            <CompactSelect value={oauth.grantType} onChange={(grantType) => updateOAuth({ grantType })} options={oauthGrantOptions} className="max-w-[260px]" />
          </FormRow>

          <TokenStatus oauth={oauth} />

          <div className="grid gap-3">
            <SectionShell icon={Sparkles} title="Configuration" subtitle="Provider endpoints and client setup">
              <div className="grid gap-2.5">
                <Field
                  label="Callback URL"
                  value={oauth.callbackUrl}
                  onChange={(callbackUrl) => updateOAuth({ callbackUrl })}
                  envVars={envVars}
                  placeholder="http://localhost:3000/callback"
                />
                <Field
                  label="Client ID"
                  value={oauth.clientId}
                  onChange={(clientId) => updateOAuth({ clientId })}
                  envVars={envVars}
                  placeholder="Client identifier"
                />
                <Field
                  label="Authorization URL"
                  value={oauth.authUrl}
                  onChange={(authUrl) => updateOAuth({ authUrl })}
                  envVars={envVars}
                  placeholder="https://example.com/oauth/authorize"
                />
                <Field
                  label="Access Token URL"
                  value={oauth.tokenUrl}
                  onChange={(tokenUrl) => updateOAuth({ tokenUrl })}
                  envVars={envVars}
                  placeholder="https://example.com/oauth/token"
                />
                <Field
                  label="Client Secret"
                  value={oauth.clientSecret}
                  onChange={(clientSecret) => updateOAuth({ clientSecret })}
                  envVars={envVars}
                  placeholder="Client secret"
                  secret
                />
                <Field
                  label="Scope"
                  value={oauth.scope}
                  onChange={(scope) => updateOAuth({ scope })}
                  envVars={envVars}
                  placeholder="openid profile email"
                />
                <Field
                  label="State"
                  value={oauth.state}
                  onChange={(state) => updateOAuth({ state })}
                  envVars={envVars}
                  placeholder="Anti-CSRF state"
                />
                <FormRow label="Add Credentials To">
                  <CompactSelect
                    value={oauth.clientAuthMethod}
                    onChange={(clientAuthMethod) => updateOAuth({ clientAuthMethod })}
                    options={oauthClientAuthMethodOptions}
                  />
                </FormRow>
              </div>

              <DividerLabel label="Optional" />

              <div className="grid gap-2.5">
                <Field
                  label="Audience"
                  value={oauth.audience}
                  onChange={(audience) => updateOAuth({ audience })}
                  envVars={envVars}
                  placeholder="Optional audience"
                />
                <Field
                  label="Resource"
                  value={oauth.resource}
                  onChange={(resource) => updateOAuth({ resource })}
                  envVars={envVars}
                  placeholder="Optional resource"
                />
                <FormRow label="Use PKCE">
                  <label className="inline-flex items-center gap-2 text-[12px] text-foreground">
                    <input
                      type="checkbox"
                      checked={oauth.usePkce}
                      onChange={(event) => updateOAuth({ usePkce: event.target.checked })}
                      className="h-3.5 w-3.5 rounded border-border/50"
                    />
                    Enable PKCE code challenge
                  </label>
                </FormRow>
                {oauth.usePkce ? (
                  <Field
                    label="Code Verifier"
                    value={oauth.codeVerifier}
                    onChange={(codeVerifier) => updateOAuth({ codeVerifier })}
                    envVars={envVars}
                    placeholder="Generated automatically if left empty"
                  />
                ) : null}
              </div>
            </SectionShell>

            <SectionShell icon={KeyRound} title="Token" subtitle="Fetch and manage credentials">
              <div className="grid gap-2.5">
                {oauth.grantType === "authorization_code" ? (
                  <Field
                    label="Authorization Code"
                    value={oauth.authorizationCode}
                    onChange={(authorizationCode) => updateOAuth({ authorizationCode })}
                    envVars={envVars}
                    placeholder="Paste callback URL or code"
                    actions={(
                      <button
                        type="button"
                        onClick={() => setShowCodeModal(true)}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        title="Open helper"
                      >
                        <Wand2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  />
                ) : null}

                {oauth.grantType === "password" ? (
                  <>
                    <Field
                      label="Username"
                      value={oauth.username}
                      onChange={(username) => updateOAuth({ username })}
                      envVars={envVars}
                      placeholder="demo@example.com"
                    />
                    <Field
                      label="Password"
                      value={oauth.password}
                      onChange={(password) => updateOAuth({ password })}
                      envVars={envVars}
                      placeholder="Password"
                      secret
                    />
                  </>
                ) : null}

                <Field
                  label="Access Token"
                  value={oauth.accessToken}
                  onChange={(accessToken) => updateOAuth({ accessToken })}
                  envVars={envVars}
                  placeholder="Stored access token"
                  secret
                  actions={oauth.accessToken ? (
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(oauth.accessToken)}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      title="Copy token"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                />
                <Field
                  label="Header Prefix"
                  value={oauth.tokenType}
                  onChange={(tokenType) => updateOAuth({ tokenType })}
                  envVars={envVars}
                  placeholder="Bearer"
                />
                <Field
                  label="Refresh Token"
                  value={oauth.refreshToken}
                  onChange={(refreshToken) => updateOAuth({ refreshToken })}
                  envVars={envVars}
                  placeholder="Optional refresh token"
                  secret
                />
              </div>
            </SectionShell>

            <SectionShell icon={Settings2} title="Advanced" subtitle="Extra token request parameters">
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Additional Parameters</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">Optional provider-specific fields.</div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => updateOAuth({ extraTokenParams: [...(oauth.extraTokenParams || []), createOAuthRow()] })}
                  >
                    Add Parameter
                  </Button>
                </div>

                {(oauth.extraTokenParams || []).length ? (
                  <div className="overflow-hidden rounded-md border border-border/18">
                    <div className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_36px] border-b border-border/12 bg-transparent px-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      <div className="py-2" />
                      <div className="py-2">Key</div>
                      <div className="py-2">Value</div>
                      <div className="py-2" />
                    </div>
                    {(oauth.extraTokenParams || []).map((row, index) => (
                      <div key={`oauth-param-${index}`} className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_36px] items-center border-b border-border/10 px-2 last:border-b-0">
                        <label className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={row.enabled ?? true}
                            onChange={(event) => {
                              const nextRows = [...(oauth.extraTokenParams || [])];
                              nextRows[index] = { ...nextRows[index], enabled: event.target.checked };
                              updateOAuth({ extraTokenParams: nextRows });
                            }}
                          />
                        </label>
                        <EnvHighlightInput
                          value={row.key}
                          onValueChange={(value) => {
                            const nextRows = [...(oauth.extraTokenParams || [])];
                            nextRows[index] = { ...nextRows[index], key: value };
                            updateOAuth({ extraTokenParams: nextRows });
                          }}
                          envVars={envVars}
                          placeholder="key"
                          inputClassName="h-9 border-0 bg-transparent text-[12px]"
                        />
                        <EnvHighlightInput
                          value={row.value}
                          onValueChange={(value) => {
                            const nextRows = [...(oauth.extraTokenParams || [])];
                            nextRows[index] = { ...nextRows[index], value };
                            updateOAuth({ extraTokenParams: nextRows });
                          }}
                          envVars={envVars}
                          placeholder="value"
                          inputClassName="h-9 border-0 bg-transparent text-[12px]"
                        />
                        <button
                          type="button"
                          onClick={() => updateOAuth({ extraTokenParams: (oauth.extraTokenParams || []).filter((_, rowIndex) => rowIndex !== index) })}
                          className="flex items-center justify-center text-muted-foreground transition-colors hover:text-danger"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </SectionShell>
          </div>
        </div>
      </div>

      <div className="border-t border-border/18 bg-transparent px-4 py-3">
        <div className="mx-auto flex max-w-[980px] flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>
              {oauth.grantType === "authorization_code"
                ? "Authorize, paste callback, then fetch the token."
                : "Set credentials, then fetch or refresh the token."}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleOpenAuthorizationPage}
              disabled={isExchanging || oauth.grantType !== "authorization_code"}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Authorize
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleExchange("refresh_token")}
              disabled={isExchanging || !oauth.refreshToken}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => persistAndNotify(
                { accessToken: "", refreshToken: "", expiresAt: "", authorizationCode: "", lastStatus: "token-cleared", lastError: "" },
                `Stored OAuth tokens cleared for this ${scopeLabel} config.`
              )}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Clear Cache
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={isExchanging ? handleCancelExchange : () => handleExchange(oauth.grantType)}
              variant={isExchanging ? "outline" : "default"}
              disabled={!isExchanging && validationErrors.length > 0}
            >
              {isExchanging ? <XCircle className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
              {isExchanging ? "Cancel" : "Get Access Token"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
