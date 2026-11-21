import { useCallback, useEffect, useState } from "react";

import "./admin.css";


// =====================================================
// ADMIN PAGE (owner only)
// =====================================================
//
// Three tabs: Reports, Videos and Users. Every action is checked again by
// the backend, so this page only works for an account marked is_admin in
// the database.

const TABS = [
  { id: "reports", label: "Reports" },
  { id: "videos", label: "Videos" },
  { id: "users", label: "Users" },
];


async function adminRequest(path, method = "GET") {
  const token = localStorage.getItem("access_token");

  try {
    const response = await fetch(`/api/admin${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    return { ok: response.ok, status: response.status, data };
  } catch {
    return {
      ok: false,
      status: 0,
      data: { message: "Could not reach the server." },
    };
  }
}


function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}


function AdminPage({ authUser, openVideo }) {
  const [tab, setTab] = useState("reports");
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [bannedOnly, setBannedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);


  // Wait a moment after typing before searching.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchText.trim());
      setPage(1);
    }, 350);

    return () => clearTimeout(timer);
  }, [searchText]);


  const showToast = useCallback((message, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 4200);
  }, []);


  // ---------- numbers at the top ----------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await adminRequest("/stats");

      if (cancelled) {
        return;
      }

      if (result.status === 403) {
        setDenied(true);
        return;
      }

      if (result.ok) {
        setStats(result.data);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);


  // ---------- the list of the current tab ----------
  useEffect(() => {
    if (denied) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");

      const params = new URLSearchParams({ page: String(page) });

      if (tab !== "reports" && query) {
        params.set("q", query);
      }

      if (tab === "users" && bannedOnly) {
        params.set("banned", "1");
      }

      const result = await adminRequest(`/${tab}?${params.toString()}`);

      if (cancelled) {
        return;
      }

      if (result.status === 403) {
        setDenied(true);
      } else if (result.ok) {
        setItems(result.data.items || []);
        setPagination(result.data.pagination || null);
      } else {
        setItems([]);
        setError(result.data.message || "Could not load this list.");
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [tab, page, query, bannedOnly, reloadKey, denied]);


  const changeTab = (nextTab) => {
    if (nextTab === tab) {
      return;
    }

    setTab(nextTab);
    setPage(1);
    setSearchText("");
    setQuery("");
    setBannedOnly(false);
    setItems([]);
    setPagination(null);
  };


  // ---------- watch a video ----------
  const watchVideo = async (video) => {
    const token = localStorage.getItem("access_token");

    try {
      const response = await fetch(`/api/videos/${video.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        showToast("Could not open this video.", true);
        return;
      }

      openVideo(await response.json());
    } catch {
      showToast("Could not open this video.", true);
    }
  };


  // ---------- actions (after the confirm box) ----------
  const runConfirmed = async () => {
    if (!confirm || busy) {
      return;
    }

    setBusy(true);

    let result;

    if (confirm.kind === "delete-video") {
      result = await adminRequest(`/videos/${confirm.video.id}`, "DELETE");
    } else if (confirm.kind === "dismiss") {
      result = await adminRequest(
        `/videos/${confirm.video.id}/reports`,
        "DELETE"
      );
    } else if (confirm.kind === "ban") {
      result = await adminRequest(`/users/${confirm.userId}/ban`, "POST");
    } else {
      result = await adminRequest(`/users/${confirm.userId}/unban`, "POST");
    }

    setBusy(false);
    setConfirm(null);

    if (result.ok) {
      showToast(result.data.message || "Done.");
      setReloadKey((key) => key + 1);
    } else {
      showToast(result.data.message || "That did not work.", true);
    }
  };


  const confirmText = () => {
    if (!confirm) {
      return null;
    }

    if (confirm.kind === "delete-video") {
      return {
        title: "Delete this video?",
        body: `"${confirm.video.title}" will be removed from the site, the database and cloud storage. This cannot be undone.`,
        button: "Delete video",
        danger: true,
      };
    }

    if (confirm.kind === "dismiss") {
      return {
        title: "Dismiss all reports?",
        body: `"${confirm.video.title}" stays on the site and its reports are cleared.`,
        button: "Dismiss reports",
        danger: false,
      };
    }

    if (confirm.kind === "ban") {
      return {
        title: `Ban ${confirm.username}?`,
        body: "Their videos and profile are hidden and they are logged out. Nothing is deleted, and you can unban them any time.",
        button: "Ban user",
        danger: true,
      };
    }

    return {
      title: `Unban ${confirm.username}?`,
      body: "Their videos and profile become visible again and they can log in.",
      button: "Unban user",
      danger: false,
    };
  };


  if (!authUser) {
    return (
      <div className="admin-page">
        <p className="admin-empty">Please log in.</p>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="admin-page">
        <h2 className="admin-title">Admin</h2>
        <p className="admin-empty">
          This page is for the site owner only.
        </p>
      </div>
    );
  }


  // ---------- one video row (Reports and Videos tabs) ----------
  const renderVideoRow = (video) => (
    <div className="admin-row" key={video.id}>

      <div className="admin-thumb">
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt="" loading="lazy" />
        ) : null}
      </div>

      <div className="admin-main">
        <p className="admin-name">{video.title}</p>

        <p className="admin-meta">
          #{video.id} · by {video.creator}
          {video.creator_banned && (
            <span className="admin-badge admin-badge-red">Creator banned</span>
          )}
          {" · "}
          {video.views} views · {formatDate(video.created_at)}
        </p>

        <div className="admin-chips">
          {video.report_count > 0 && (
            <span className="admin-badge admin-badge-red">
              {video.report_count} report{video.report_count === 1 ? "" : "s"}
            </span>
          )}

          {(video.reasons || []).map((item) => (
            <span className="admin-badge" key={item.reason}>
              {item.reason} × {item.count}
            </span>
          ))}
        </div>
      </div>

      <div className="admin-actions">
        <button
          type="button"
          className="admin-btn"
          onClick={() => watchVideo(video)}
        >
          Watch
        </button>

        {tab === "reports" && (
          <button
            type="button"
            className="admin-btn"
            onClick={() => setConfirm({ kind: "dismiss", video })}
          >
            Dismiss
          </button>
        )}

        {video.creator_banned ? (
          <button
            type="button"
            className="admin-btn"
            onClick={() =>
              setConfirm({
                kind: "unban",
                userId: video.creator_id,
                username: video.creator,
              })
            }
          >
            Unban creator
          </button>
        ) : (
          <button
            type="button"
            className="admin-btn"
            onClick={() =>
              setConfirm({
                kind: "ban",
                userId: video.creator_id,
                username: video.creator,
              })
            }
          >
            Ban creator
          </button>
        )}

        <button
          type="button"
          className="admin-btn admin-btn-danger"
          onClick={() => setConfirm({ kind: "delete-video", video })}
        >
          Delete
        </button>
      </div>

    </div>
  );


  // ---------- one user row (Users tab) ----------
  const renderUserRow = (user) => (
    <div className="admin-row" key={user.id}>

      <div className="admin-avatar">
        {user.profile_photo_url ? (
          <img src={user.profile_photo_url} alt="" loading="lazy" />
        ) : (
          (user.username || "U").charAt(0).toUpperCase()
        )}
      </div>

      <div className="admin-main">
        <p className="admin-name">
          {user.username}
          {user.is_admin && (
            <span className="admin-badge admin-badge-purple">Admin</span>
          )}
          {user.is_banned && (
            <span className="admin-badge admin-badge-red">Banned</span>
          )}
        </p>

        <p className="admin-meta">
          #{user.id} · {user.email}
          {user.name ? ` · ${user.name}` : ""}
        </p>

        <p className="admin-meta">
          {user.videos} video{user.videos === 1 ? "" : "s"} ·{" "}
          {user.reports_received} report
          {user.reports_received === 1 ? "" : "s"} received · joined{" "}
          {formatDate(user.created_at)}
        </p>
      </div>

      <div className="admin-actions">
        {!user.is_admin &&
          (user.is_banned ? (
            <button
              type="button"
              className="admin-btn"
              onClick={() =>
                setConfirm({
                  kind: "unban",
                  userId: user.id,
                  username: user.username,
                })
              }
            >
              Unban
            </button>
          ) : (
            <button
              type="button"
              className="admin-btn admin-btn-danger"
              onClick={() =>
                setConfirm({
                  kind: "ban",
                  userId: user.id,
                  username: user.username,
                })
              }
            >
              Ban
            </button>
          ))}
      </div>

    </div>
  );


  const dialog = confirmText();


  return (
    <div className="admin-page">

      <h2 className="admin-title">Admin</h2>

      <p className="admin-sub">
        Keep ReelVerse clean. Only you can see this page.
      </p>

      {stats && (
        <div className="admin-stats">
          <div><strong>{stats.users}</strong><span>Users</span></div>
          <div><strong>{stats.banned_users}</strong><span>Banned</span></div>
          <div><strong>{stats.videos}</strong><span>Videos</span></div>
          <div><strong>{stats.reported_videos}</strong><span>Reported</span></div>
        </div>
      )}

      <div className="admin-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`admin-tab ${tab === item.id ? "active" : ""}`}
            onClick={() => changeTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab !== "reports" && (
        <div className="admin-toolbar">
          <input
            type="search"
            className="admin-search"
            placeholder={
              tab === "videos"
                ? "Search by title, creator or video number"
                : "Search by username, email, name or user number"
            }
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />

          {tab === "users" && (
            <label className="admin-check">
              <input
                type="checkbox"
                checked={bannedOnly}
                onChange={(event) => {
                  setBannedOnly(event.target.checked);
                  setPage(1);
                }}
              />
              Banned only
            </label>
          )}
        </div>
      )}

      {error && <p className="admin-error">{error}</p>}

      {loading && items.length === 0 ? (
        <p className="admin-empty">Loading…</p>
      ) : items.length === 0 && !error ? (
        <p className="admin-empty">
          {tab === "reports"
            ? "No reported videos. The site looks clean."
            : "Nothing found."}
        </p>
      ) : (
        <div className={`admin-list ${loading ? "loading" : ""}`}>
          {items.map((item) =>
            tab === "users" ? renderUserRow(item) : renderVideoRow(item)
          )}
        </div>
      )}

      {pagination && pagination.total_pages > 1 && (
        <div className="admin-pager">
          <button
            type="button"
            className="admin-btn"
            disabled={!pagination.has_previous}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            ← Previous
          </button>

          <span>
            Page {pagination.page} of {pagination.total_pages}
          </span>

          <button
            type="button"
            className="admin-btn"
            disabled={!pagination.has_next}
            onClick={() => setPage((value) => value + 1)}
          >
            Next →
          </button>
        </div>
      )}

      {dialog && (
        <div
          className="admin-overlay"
          onClick={() => !busy && setConfirm(null)}
        >
          <div
            className="admin-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>{dialog.title}</h3>
            <p>{dialog.body}</p>

            <div className="admin-dialog-actions">
              <button
                type="button"
                className="admin-btn"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>

              <button
                type="button"
                className={`admin-btn ${
                  dialog.danger ? "admin-btn-danger-solid" : "admin-btn-solid"
                }`}
                disabled={busy}
                onClick={runConfirmed}
              >
                {busy ? "Please wait…" : dialog.button}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`admin-toast ${toast.isError ? "error" : ""}`}
          role="status"
        >
          {toast.message}
        </div>
      )}

    </div>
  );
}


export default AdminPage;