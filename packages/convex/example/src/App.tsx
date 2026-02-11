import "./App.css";
import { useAction, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

function tryParseJson(
  str: string,
  addLog: (msg: string) => void,
  field: string,
): unknown | undefined {
  const trimmed = str.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    addLog(`Parse error in ${field}: invalid JSON`);
    return undefined;
  }
}

function Section({
  num,
  title,
  accent,
  children,
  defaultOpen = true,
}: {
  num: number;
  title: string;
  accent: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className="sdk-section"
      style={{ "--accent": accent } as React.CSSProperties}
    >
      <button
        className="section-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="section-num">{num}</span>
        <span className="section-label">{title}</span>
        <svg
          className={`chevron ${open ? "open" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </button>
      {open && <div className="section-content">{children}</div>}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "field--wide" : ""}`}>
      <span className="field-label">
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function App() {
  // Shared
  const [distinctId, setDistinctId] = useState("user-123");

  // 1. Capture
  const [captureEvent, setCaptureEvent] = useState("button_clicked");
  const [captureProps, setCaptureProps] = useState(
    '{"plan":"pro","amount":99}',
  );
  const [captureGroups, setCaptureGroups] = useState('{"company":"acme"}');
  const [captureSendFlags, setCaptureSendFlags] = useState(false);
  const [captureGeoip, setCaptureGeoip] = useState(false);
  const [captureUuid, setCaptureUuid] = useState("");
  const [captureTimestamp, setCaptureTimestamp] = useState("");

  // 2. Identify
  const [identifyProps, setIdentifyProps] = useState(
    '{"name":"Test User","email":"test@example.com","plan":"pro"}',
  );
  const [identifyGeoip, setIdentifyGeoip] = useState(false);

  // 3. Group Identify
  const [groupType, setGroupType] = useState("company");
  const [groupKey, setGroupKey] = useState("acme");
  const [groupProps, setGroupProps] = useState(
    '{"industry":"Technology","size":100}',
  );
  const [groupDistinctId, setGroupDistinctId] = useState("");
  const [groupGeoip, setGroupGeoip] = useState(false);

  // 4. Alias
  const [aliasValue, setAliasValue] = useState("anon-456");
  const [aliasGeoip, setAliasGeoip] = useState(false);

  // 5. Capture Exception
  const [errorMsg, setErrorMsg] = useState("Something went wrong");
  const [errorType, setErrorType] = useState<"error" | "string" | "object">(
    "error",
  );
  const [exceptionProps, setExceptionProps] = useState('{"page":"/checkout"}');
  const [exceptionDistinctId, setExceptionDistinctId] = useState("");

  // 6. Feature Flags
  const [flagKey, setFlagKey] = useState("test-flag");
  const [ffGroups, setFfGroups] = useState('{"company":"acme"}');
  const [ffPersonProps, setFfPersonProps] = useState(
    '{"email":"test@example.com"}',
  );
  const [ffGroupProps, setFfGroupProps] = useState(
    '{"company":{"industry":"tech"}}',
  );
  const [ffSendEvents, setFfSendEvents] = useState(false);
  const [ffGeoip, setFfGeoip] = useState(false);
  const [ffMatchValue, setFfMatchValue] = useState("");
  const [ffFlagKeys, setFfFlagKeys] = useState("");

  // Log & button status
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement>(null);
  const [btnStatus, setBtnStatus] = useState<
    Record<string, "loading" | "success" | "error">
  >({});
  const addLog = useCallback(
    (msg: string) =>
      setLog((prev) => [...prev, `${new Date().toLocaleTimeString()} ${msg}`]),
    [],
  );

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // Convex hooks
  const captureM = useMutation(api.example.testCapture);
  const identifyM = useMutation(api.example.testIdentify);
  const groupIdentifyM = useMutation(api.example.testGroupIdentify);
  const aliasM = useMutation(api.example.testAlias);
  const captureExceptionM = useMutation(api.example.testCaptureException);

  const getFeatureFlagA = useAction(api.example.testGetFeatureFlag);
  const isFeatureEnabledA = useAction(api.example.testIsFeatureEnabled);
  const getPayloadA = useAction(api.example.testGetFeatureFlagPayload);
  const getResultA = useAction(api.example.testGetFeatureFlagResult);
  const getAllFlagsA = useAction(api.example.testGetAllFlags);
  const getAllPayloadsA = useAction(api.example.testGetAllFlagsAndPayloads);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBtnStatus((s) => ({ ...s, [label]: "loading" }));
    addLog(`${label}...`);
    let outcome: "success" | "error" = "success";
    try {
      const result = await fn();
      addLog(`${label} -> ${JSON.stringify(result)}`);
    } catch (e) {
      addLog(`${label} ERROR: ${e}`);
      outcome = "error";
    }
    setBtnStatus((s) => ({ ...s, [label]: outcome }));
    setTimeout(() => {
      setBtnStatus((s) => {
        const next = { ...s };
        if (next[label] === outcome) delete next[label];
        return next;
      });
    }, 2000);
  };

  const btnProps = (label: string) => {
    const status = btnStatus[label];
    return {
      className: `btn${status ? ` btn--${status}` : ""}`,
      disabled: status === "loading",
    };
  };

  const json = (str: string, field: string) => tryParseJson(str, addLog, field);

  const ffArgs = () => ({
    distinctId,
    flagKey,
    groups: json(ffGroups, "FF groups") as Record<string, string> | undefined,
    personProperties: json(ffPersonProps, "FF person props") as
      | Record<string, string>
      | undefined,
    groupProperties: json(ffGroupProps, "FF group props") as
      | Record<string, Record<string, string>>
      | undefined,
    sendFeatureFlagEvents: ffSendEvents || undefined,
    disableGeoip: ffGeoip || undefined,
  });

  const ffAllArgs = () => {
    const keys = ffFlagKeys.trim()
      ? ffFlagKeys
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)
      : undefined;
    return {
      distinctId,
      groups: json(ffGroups, "FF groups") as Record<string, string> | undefined,
      personProperties: json(ffPersonProps, "FF person props") as
        | Record<string, string>
        | undefined,
      groupProperties: json(ffGroupProps, "FF group props") as
        | Record<string, Record<string, string>>
        | undefined,
      disableGeoip: ffGeoip || undefined,
      flagKeys: keys,
    };
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span className="brand-post">Post</span>
          <span className="brand-hog">Hog</span>
          <span className="brand-sep">&times;</span>
          <span className="brand-convex">Convex</span>
        </h1>
        <p className="subtitle">SDK Explorer</p>
      </header>

      <div className="shared-inputs">
        <Field label="Distinct ID">
          <input
            type="text"
            value={distinctId}
            onChange={(e) => setDistinctId(e.target.value)}
            placeholder="user-123"
          />
        </Field>
      </div>

      <div className="sections">
        {/* 1. Event Capture */}
        <Section num={1} title="Event Capture" accent="#60a5fa">
          <div className="field-grid">
            <Field label="Event name">
              <input
                value={captureEvent}
                onChange={(e) => setCaptureEvent(e.target.value)}
              />
            </Field>
            <Field label="UUID" hint="optional">
              <input
                value={captureUuid}
                onChange={(e) => setCaptureUuid(e.target.value)}
                placeholder="auto-generated"
              />
            </Field>
            <Field label="Properties" hint="JSON" wide>
              <textarea
                value={captureProps}
                onChange={(e) => setCaptureProps(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="Groups" hint="JSON" wide>
              <textarea
                value={captureGroups}
                onChange={(e) => setCaptureGroups(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="Timestamp" hint="ISO 8601">
              <input
                value={captureTimestamp}
                onChange={(e) => setCaptureTimestamp(e.target.value)}
                placeholder="2024-01-01T00:00:00Z"
              />
            </Field>
            <div className="checkbox-row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={captureSendFlags}
                  onChange={(e) => setCaptureSendFlags(e.target.checked)}
                />
                Send feature flags
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={captureGeoip}
                  onChange={(e) => setCaptureGeoip(e.target.checked)}
                />
                Disable GeoIP
              </label>
            </div>
          </div>
          <div className="actions">
            <button
              {...btnProps("capture")}
              onClick={() =>
                run("capture", () =>
                  captureM({
                    distinctId,
                    event: captureEvent,
                    properties: json(captureProps, "properties"),
                    groups: json(captureGroups, "groups"),
                    sendFeatureFlags: captureSendFlags || undefined,
                    timestamp: captureTimestamp || undefined,
                    uuid: captureUuid || undefined,
                    disableGeoip: captureGeoip || undefined,
                  }),
                )
              }
            >
              Capture
            </button>
          </div>
        </Section>

        {/* 2. Identify */}
        <Section num={2} title="Identify" accent="#34d399">
          <div className="field-grid">
            <Field
              label="Properties"
              hint="JSON -- sent as $set properties"
              wide
            >
              <textarea
                value={identifyProps}
                onChange={(e) => setIdentifyProps(e.target.value)}
                rows={3}
              />
            </Field>
            <div className="checkbox-row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={identifyGeoip}
                  onChange={(e) => setIdentifyGeoip(e.target.checked)}
                />
                Disable GeoIP
              </label>
            </div>
          </div>
          <div className="actions">
            <button
              {...btnProps("identify")}
              onClick={() =>
                run("identify", () =>
                  identifyM({
                    distinctId,
                    properties: json(identifyProps, "properties"),
                    disableGeoip: identifyGeoip || undefined,
                  }),
                )
              }
            >
              Identify
            </button>
          </div>
        </Section>

        {/* 3. Group Identify */}
        <Section num={3} title="Group Identify" accent="#a78bfa">
          <div className="field-grid">
            <Field label="Group type">
              <input
                value={groupType}
                onChange={(e) => setGroupType(e.target.value)}
              />
            </Field>
            <Field label="Group key">
              <input
                value={groupKey}
                onChange={(e) => setGroupKey(e.target.value)}
              />
            </Field>
            <Field label="Properties" hint="JSON" wide>
              <textarea
                value={groupProps}
                onChange={(e) => setGroupProps(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="Distinct ID" hint="optional override">
              <input
                value={groupDistinctId}
                onChange={(e) => setGroupDistinctId(e.target.value)}
                placeholder="uses shared ID if empty"
              />
            </Field>
            <div className="checkbox-row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={groupGeoip}
                  onChange={(e) => setGroupGeoip(e.target.checked)}
                />
                Disable GeoIP
              </label>
            </div>
          </div>
          <div className="actions">
            <button
              {...btnProps("groupIdentify")}
              onClick={() =>
                run("groupIdentify", () =>
                  groupIdentifyM({
                    groupType,
                    groupKey,
                    properties: json(groupProps, "properties"),
                    distinctId: groupDistinctId || undefined,
                    disableGeoip: groupGeoip || undefined,
                  }),
                )
              }
            >
              Group Identify
            </button>
          </div>
        </Section>

        {/* 4. Alias */}
        <Section num={4} title="Alias" accent="#fb923c">
          <div className="field-grid">
            <Field label="Alias">
              <input
                value={aliasValue}
                onChange={(e) => setAliasValue(e.target.value)}
              />
            </Field>
            <div className="checkbox-row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={aliasGeoip}
                  onChange={(e) => setAliasGeoip(e.target.checked)}
                />
                Disable GeoIP
              </label>
            </div>
          </div>
          <div className="actions">
            <button
              {...btnProps("alias")}
              onClick={() =>
                run("alias", () =>
                  aliasM({
                    distinctId,
                    alias: aliasValue,
                    disableGeoip: aliasGeoip || undefined,
                  }),
                )
              }
            >
              Create Alias
            </button>
          </div>
        </Section>

        {/* 5. Capture Exception */}
        <Section num={5} title="Capture Exception" accent="#f87171">
          <div className="field-grid">
            <Field label="Error message">
              <input
                value={errorMsg}
                onChange={(e) => setErrorMsg(e.target.value)}
              />
            </Field>
            <Field label="Error type">
              <select
                value={errorType}
                onChange={(e) =>
                  setErrorType(e.target.value as "error" | "string" | "object")
                }
              >
                <option value="error">Error object</option>
                <option value="string">String</option>
                <option value="object">Object with message</option>
              </select>
            </Field>
            <Field label="Additional properties" hint="JSON" wide>
              <textarea
                value={exceptionProps}
                onChange={(e) => setExceptionProps(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="Distinct ID" hint="optional override">
              <input
                value={exceptionDistinctId}
                onChange={(e) => setExceptionDistinctId(e.target.value)}
                placeholder="uses shared ID if empty"
              />
            </Field>
          </div>
          <div className="actions">
            <button
              {...btnProps("captureException")}
              onClick={() =>
                run("captureException", () =>
                  captureExceptionM({
                    errorMessage: errorMsg,
                    errorType,
                    distinctId: exceptionDistinctId || undefined,
                    additionalProperties: json(
                      exceptionProps,
                      "additional properties",
                    ),
                  }),
                )
              }
            >
              Capture Exception
            </button>
          </div>
        </Section>

        {/* 6. Feature Flags */}
        <Section num={6} title="Feature Flags" accent="#22d3ee">
          <div className="field-grid">
            <Field label="Flag key">
              <input
                value={flagKey}
                onChange={(e) => setFlagKey(e.target.value)}
              />
            </Field>
            <Field label="Match value" hint="for payload">
              <input
                value={ffMatchValue}
                onChange={(e) => setFfMatchValue(e.target.value)}
                placeholder="boolean or string"
              />
            </Field>
            <Field label="Groups" hint="JSON" wide>
              <textarea
                value={ffGroups}
                onChange={(e) => setFfGroups(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="Person properties" hint="JSON" wide>
              <textarea
                value={ffPersonProps}
                onChange={(e) => setFfPersonProps(e.target.value)}
                rows={2}
              />
            </Field>
            <Field label="Group properties" hint="JSON" wide>
              <textarea
                value={ffGroupProps}
                onChange={(e) => setFfGroupProps(e.target.value)}
                rows={2}
              />
            </Field>
            <Field
              label="Flag keys filter"
              hint="comma-separated, for getAll"
              wide
            >
              <input
                value={ffFlagKeys}
                onChange={(e) => setFfFlagKeys(e.target.value)}
                placeholder="flag-1, flag-2"
              />
            </Field>
            <div className="checkbox-row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={ffSendEvents}
                  onChange={(e) => setFfSendEvents(e.target.checked)}
                />
                Send flag events
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={ffGeoip}
                  onChange={(e) => setFfGeoip(e.target.checked)}
                />
                Disable GeoIP
              </label>
            </div>
          </div>
          <div className="actions actions--wrap">
            <button
              {...btnProps("getFeatureFlag")}
              onClick={() =>
                run("getFeatureFlag", () => getFeatureFlagA(ffArgs()))
              }
            >
              getFeatureFlag
            </button>
            <button
              {...btnProps("isFeatureEnabled")}
              onClick={() =>
                run("isFeatureEnabled", () => isFeatureEnabledA(ffArgs()))
              }
            >
              isFeatureEnabled
            </button>
            <button
              {...btnProps("getFeatureFlagPayload")}
              onClick={() => {
                const args = ffArgs();
                const mv = ffMatchValue.trim();
                let matchValue: boolean | string | undefined;
                if (mv === "true") matchValue = true;
                else if (mv === "false") matchValue = false;
                else if (mv) matchValue = mv;
                run("getFeatureFlagPayload", () =>
                  getPayloadA({ ...args, matchValue }),
                );
              }}
            >
              getFeatureFlagPayload
            </button>
            <button
              {...btnProps("getFeatureFlagResult")}
              onClick={() =>
                run("getFeatureFlagResult", () => getResultA(ffArgs()))
              }
            >
              getFeatureFlagResult
            </button>
            <button
              {...btnProps("getAllFlags")}
              onClick={() =>
                run("getAllFlags", () => getAllFlagsA(ffAllArgs()))
              }
            >
              getAllFlags
            </button>
            <button
              {...btnProps("getAllFlagsAndPayloads")}
              onClick={() =>
                run("getAllFlagsAndPayloads", () =>
                  getAllPayloadsA(ffAllArgs()),
                )
              }
            >
              getAllFlagsAndPayloads
            </button>
          </div>
        </Section>
      </div>

      <div className="log-panel">
        <div className="log-header">
          <span className="log-title">Log</span>
          <button className="btn btn--ghost" onClick={() => setLog([])}>
            Clear
          </button>
        </div>
        <pre className="log-output" ref={logRef}>
          {log.length ? log.join("\n") : "Ready. Click any action to test."}
        </pre>
      </div>
    </div>
  );
}

export default App;
