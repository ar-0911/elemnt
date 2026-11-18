import { useCallback, useEffect, useState } from "react";
import { api, type ApiError, type Space } from "./api";
import { Dialog, useToast } from "./ui";

interface Person {
  userId: string;
  email: string;
  name: string | null;
  username: string | null;
  role: string;
  /** Owners can always read every space and can't be removed here. */
  always?: boolean;
}

const label = (p: Person) => p.name || p.username || p.email;

/** Who can read a private space. Only owners see this. */
export function SpaceMembersDialog({ space, onClose }: { space: Space; onClose(): void }) {
  const toast = useToast();
  const [people, setPeople] = useState<Person[]>();
  const [workspace, setWorkspace] = useState<Person[]>([]);
  const [pick, setPick] = useState("");

  const load = useCallback(() => {
    void api.get<{ members: Person[] }>(`/api/spaces/${space.slug}/members`).then((r) => setPeople(r.members));
    void api.get<{ members: Person[] }>("/api/members").then((r) => setWorkspace(r.members));
  }, [space.slug]);
  useEffect(load, [load]);

  async function run(work: Promise<unknown>, done: string) {
    try {
      await work;
      toast(done);
    } catch (err) {
      toast((err as ApiError).message, "error");
    }
    load();
  }

  const addable = workspace.filter((w) => !people?.some((p) => p.userId === w.userId));

  return (
    <Dialog title={`Who can read ${space.name}`} onClose={onClose}>
      <div className="form">
        <p className="hint">
          This space is private. Only the people below can find or open its pages, in the app, search, Ask and through Claude. Owners can always read every space.
        </p>
        {!people ? (
          <p className="hint">Loading…</p>
        ) : (
          <ul className="invite-list">
            {people.map((p) => (
              <li key={p.userId}>
                <span>
                  <strong>{label(p)}</strong> <span className="hint">{p.email}</span>
                </span>
                {p.always ? (
                  <span className="pill">owner</span>
                ) : (
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => void run(api.del(`/api/spaces/${space.slug}/members/${p.userId}`), `${label(p)} can no longer read ${space.name}.`)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {addable.length > 0 ? (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pick) return;
              const who = addable.find((a) => a.userId === pick);
              setPick("");
              void run(api.put(`/api/spaces/${space.slug}/members/${pick}`, {}), `${who ? label(who) : "They"} can now read ${space.name}.`);
            }}
          >
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Person to add">
              <option value="">Add someone from the workspace…</option>
              {addable.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {label(a)} ({a.role})
                </option>
              ))}
            </select>
            <button type="submit" className="btn primary" disabled={!pick}>
              Add
            </button>
          </form>
        ) : (
          <p className="hint">Everyone in the workspace is already here. Invite more people in Settings, then add them.</p>
        )}
      </div>
    </Dialog>
  );
}
