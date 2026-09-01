/**
 * A screen the server's portal lists but this client has no component for yet.
 *
 * Visible rather than silent, deliberately: ERP Bible V3 lands over five phases, and a
 * portal entry that renders a blank page is indistinguishable from a broken one.
 */
export function NotImplemented({ screen }: { screen: string }) {
  return (
    <div>
      <h1 className="page-title">Not <em>yet</em></h1>
      <div className="page-sub">// SCREEN {screen.toUpperCase()}</div>
      <div className="offline-banner" style={{ marginTop: 20 }}>
        This screen is part of a later phase of the ERP Bible V3 rollout. Its route and
        permissions exist; the interface does not yet.
      </div>
    </div>
  );
}
