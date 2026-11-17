import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";

import { io } from "socket.io-client";

import VideoPlayer from "./VideoPlayer.jsx";

import "./index.css";
import "./theme.css";

// Address of the chat (Socket.IO) server. On your computer this stays
// http://127.0.0.1:5000. When hosted, set VITE_API_URL (or VITE_SOCKET_URL)
// to the backend address, for example https://reelverse-api.onrender.com
const SOCKET_URL = String(
  import.meta.env.VITE_SOCKET_URL ||
    import.meta.env.VITE_API_URL ||
    "http://127.0.0.1:5000"
).replace(/\/+$/, "");


// =====================================================
// SHARE HELPERS (links that open the live page)
// =====================================================

async function copyLinkToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const box = document.createElement("textarea");
      box.value = text;
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(box);
      return copied;
    } catch {
      return false;
    }
  }
}


// Phones open their own share sheet. Computers copy the link.
// Returns a short message to show to the person.
async function shareLink({ title, text, url, copiedMessage }) {
  if (
    navigator.share &&
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  ) {
    try {
      await navigator.share({ title, text, url });
      return "";
    } catch (err) {
      if (err && err.name === "AbortError") {
        return "";
      }
    }
  }

  const copied = await copyLinkToClipboard(url);

  return copied ? copiedMessage : `Copy this link: ${url}`;
}


// =====================================================
// VIDEO CARD
// =====================================================

function VideoCard({
  video,
  openVideo,
  openComments,
  commentsCount,
  liked,
  onToggleLike,
  likeLoading,
  bookmarked,
  onToggleBookmark,
  bookmarkLoading,
}) {
  const navigate = useNavigate();

  // REPORT-1D: Per-video report menu + dialog
  const [reportMenuOpen, setReportMenuOpen] = useState(false);

  // The menu is drawn on top of the page so rows and cards never cut it off.
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const menuButtonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!reportMenuOpen) {
      return undefined;
    }

    const close = () => setReportMenuOpen(false);

    const closeOnOutsideClick = (event) => {
      if (
        menuRef.current?.contains(event.target) ||
        menuButtonRef.current?.contains(event.target)
      ) {
        return;
      }

      setReportMenuOpen(false);
    };

    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("mousedown", closeOnOutsideClick);

    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, [reportMenuOpen]);

  // Share link shown in a small message at the bottom of the screen.
  const [shareNote, setShareNote] = useState("");
  const shareNoteTimerRef = useRef(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportSuccess, setReportSuccess] = useState("");

  // DELETE: only the owner of a video can delete it. The backend also
  // removes the video files from cloud storage.
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [videoDeleted, setVideoDeleted] = useState(false);

  let currentUserId = null;

  try {
    const savedUser = JSON.parse(localStorage.getItem("user") || "null");

    currentUserId =
      savedUser && savedUser.id ? Number(savedUser.id) : null;
  } catch {
    currentUserId = null;
  }

  const isVideoOwner =
    currentUserId !== null &&
    Number(video.creator_id) === currentUserId;

  const openDeleteDialog = (event) => {
    event.stopPropagation();

    setReportMenuOpen(false);
    setDeleteError("");
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    if (deleteLoading) {
      return;
    }

    setDeleteDialogOpen(false);
    setDeleteError("");
  };

  const confirmDeleteVideo = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const token = localStorage.getItem("access_token");

    if (!token) {
      setDeleteDialogOpen(false);
      navigate("/login");
      return;
    }

    try {
      setDeleteLoading(true);
      setDeleteError("");

      const response = await fetch(`/api/videos/${video.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || data.msg || "Unable to delete this video."
        );
      }

      setDeleteDialogOpen(false);
      setVideoDeleted(true);

      // Tell the rest of the app to remove this video from its lists.
      window.dispatchEvent(
        new CustomEvent("reelverse:video-deleted", {
          detail: { id: video.id },
        })
      );
    } catch (err) {
      console.error("Video delete failed:", err);
      setDeleteError(err.message || "Unable to delete this video.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleShareFromMenu = async (event) => {
    event.stopPropagation();
    setReportMenuOpen(false);

    const message = await shareLink({
      title: video.title,
      text: `Watch "${video.title}" by ${video.creator} on ReelVerse`,
      url: `${window.location.origin}/?v=${video.id}`,
      copiedMessage: "Video link copied!",
    });

    if (!message) {
      return;
    }

    setShareNote(message);

    if (shareNoteTimerRef.current) {
      clearTimeout(shareNoteTimerRef.current);
    }

    shareNoteTimerRef.current = setTimeout(() => setShareNote(""), 2600);
  };

  const openReportDialog = (event) => {
    event.stopPropagation();

    const token = localStorage.getItem("access_token");

    if (!token) {
      setReportMenuOpen(false);
      navigate("/login");
      return;
    }

    setReportMenuOpen(false);
    setReportReason("");
    setReportError("");
    setReportSuccess("");
    setReportDialogOpen(true);
  };

  const closeReportDialog = () => {
    if (reportLoading) {
      return;
    }

    setReportDialogOpen(false);
    setReportReason("");
    setReportError("");
    setReportSuccess("");
  };

  const submitVideoReport = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const token = localStorage.getItem("access_token");

    if (!token) {
      setReportDialogOpen(false);
      navigate("/login");
      return;
    }

    if (!reportReason) {
      setReportError("Please choose a reason for reporting this video.");
      return;
    }

    try {
      setReportLoading(true);
      setReportError("");
      setReportSuccess("");

      const response = await fetch(`/api/videos/${video.id}/report`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: reportReason }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || data.msg || "Unable to report this video."
        );
      }

      setReportSuccess(data.message || "Video reported successfully.");

      window.setTimeout(() => {
        setReportDialogOpen(false);
        setReportReason("");
        setReportSuccess("");
      }, 900);
    } catch (err) {
      console.error("Video report failed:", err);
      setReportError(err.message || "Unable to report this video.");
    } finally {
      setReportLoading(false);
    }
  };

  const openCreatorProfile = () => {
    if (!video.creator_id) {
      return;
    }

    navigate(`/users/${video.creator_id}`);
  };

  if (videoDeleted) {
    return null;
  }

  return (
    <article className="video-card" key={video.id}>
      <div
        className="thumbnail-container"
        onClick={() => openVideo(video)}
        style={{ cursor: "pointer" }}
      >
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="video-thumbnail"
            onError={(event) => {
              event.currentTarget.style.display = "none";
              event.currentTarget.parentElement.classList.add(
                "thumbnail-fallback"
              );
            }}
          />
        ) : (
          <div className="thumbnail-fallback">
            ReelVerse
          </div>
        )}

        <button
          className="play-button"
          onClick={(event) => {
            event.stopPropagation();
            openVideo(video);
          }}
        >
          ▶
        </button>

        <span className="category-badge">
          {video.category || "General"}
        </span>
      </div>

      <div className="video-info" style={{ position: "relative" }}>

        <div style={{ position: "absolute", top: "0", right: "0", zIndex: 5 }}>
          <button
            type="button"
            ref={menuButtonRef}
            aria-label="Video options"
            title="Video options"
            onClick={(event) => {
              event.stopPropagation();

              const rect = event.currentTarget.getBoundingClientRect();
              const opensUp = rect.bottom + 170 > window.innerHeight;

              setMenuPosition(
                opensUp
                  ? {
                      bottom: window.innerHeight - rect.top + 6,
                      right: Math.max(8, window.innerWidth - rect.right),
                    }
                  : {
                      top: rect.bottom + 6,
                      right: Math.max(8, window.innerWidth - rect.right),
                    }
              );

              setReportMenuOpen((current) => !current);
            }}
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "50%",
              border: "1px solid #30303a",
              background: "#15151b",
              color: "#d8d8df",
              cursor: "pointer",
              fontSize: "20px",
              lineHeight: 1,
            }}
          >
            ⋮
          </button>

          {reportMenuOpen && createPortal(
            <div
              ref={menuRef}
              onClick={(event) => event.stopPropagation()}
              style={{
                position: "fixed",
                zIndex: 10001,
                ...menuPosition,
                minWidth: "150px",
                padding: "6px",
                border: "1px solid #30303a",
                borderRadius: "10px",
                background: "#15151b",
                boxShadow: "0 14px 35px rgba(0,0,0,0.35)",
              }}
            >
              <button
                type="button"
                onClick={openReportDialog}
                style={{
                  width: "100%",
                  border: "none",
                  borderRadius: "7px",
                  background: "transparent",
                  color: "#ff8a9b",
                  padding: "10px 12px",
                  textAlign: "left",
                  cursor: "pointer",
                  fontWeight: "650",
                }}
              >
                ⚑ Report video
              </button>

              <button
                type="button"
                onClick={handleShareFromMenu}
                style={{
                  width: "100%",
                  border: "none",
                  borderRadius: "7px",
                  background: "transparent",
                  color: "#c4a7ff",
                  padding: "10px 12px",
                  textAlign: "left",
                  cursor: "pointer",
                  fontWeight: "650",
                }}
              >
                🔗 Share video
              </button>

              {isVideoOwner && (
                <button
                  type="button"
                  onClick={openDeleteDialog}
                  style={{
                    width: "100%",
                    border: "none",
                    borderRadius: "7px",
                    background: "transparent",
                    color: "#ff6b81",
                    padding: "10px 12px",
                    textAlign: "left",
                    cursor: "pointer",
                    fontWeight: "650",
                  }}
                >
                  🗑 Delete video
                </button>
              )}
            </div>,
            document.body
          )}
        </div>

        <div
          className="creator-row"
          onClick={openCreatorProfile}
          role={video.creator_id ? "button" : undefined}
          tabIndex={video.creator_id ? 0 : undefined}
          onKeyDown={(event) => {
            if (
              video.creator_id &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              openCreatorProfile();
            }
          }}
          style={{
            cursor: video.creator_id ? "pointer" : "default",
          }}
          title={
            video.creator_id
              ? `View ${video.creator || "creator"}'s profile`
              : undefined
          }
        >

          <div className="creator-avatar" style={{ overflow: "hidden" }}>
            {video.creator_profile_photo_url ? (
              <img
                src={video.creator_profile_photo_url}
                alt={`${video.creator || "Creator"} profile`}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                  const fallback = event.currentTarget.nextElementSibling;
                  if (fallback) {
                    fallback.style.display = "flex";
                  }
                }}
              />
            ) : null}

            <span
              style={{
                width: "100%",
                height: "100%",
                alignItems: "center",
                justifyContent: "center",
                display: video.creator_profile_photo_url ? "none" : "flex",
              }}
            >
              {video.creator
                ? video.creator.charAt(0).toUpperCase()
                : "U"}
            </span>
          </div>

          <div>
            <p className="creator-name">
              {video.creator || "Unknown"}
            </p>

            <p className="creator-label">
              Creator
            </p>
          </div>

        </div>

        <h4>
          {video.title}
        </h4>

        <p className="video-description">
          {video.description ||
            "No description available."}
        </p>

        <div className="video-stats">

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleLike(video);
            }}
            disabled={likeLoading}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              margin: 0,
              color: liked ? "#ff4d6d" : "inherit",
              cursor: likeLoading ? "wait" : "pointer",
              font: "inherit",
            }}
            title={
              liked
                ? "Unlike this video"
                : "Like this video"
            }
          >
            {liked ? "♥" : "♡"}{" "}
            {video.likes || 0}
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openComments(video);
            }}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              margin: 0,
              color: "inherit",
              cursor: "pointer",
              font: "inherit",
            }}
            title="View comments"
          >
            💬 {commentsCount || 0}
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleBookmark(video);
            }}
            disabled={bookmarkLoading}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              margin: 0,
              color: bookmarked ? "#a855f7" : "inherit",
              cursor: bookmarkLoading ? "wait" : "pointer",
              font: "inherit",
            }}
            title={
              bookmarked
                ? "Remove from bookmarks"
                : "Save this video"
            }
          >
            {bookmarked ? "🔖 Saved" : "🔖 Save"}
          </button>

          <span>
            ◉ {video.views || 0}
          </span>

        </div>

      </div>

      {deleteDialogOpen && (
        <div
          onClick={closeDeleteDialog}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            background: "rgba(0,0,0,0.72)",
          }}
        >
          <form
            onSubmit={confirmDeleteVideo}
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(440px, 100%)",
              padding: "24px",
              border: "1px solid #30303a",
              borderRadius: "16px",
              background: "#121217",
              boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}>
              <div>
                <h3 style={{ margin: 0, color: "#ffffff" }}>Delete video</h3>
                <p style={{ margin: "7px 0 0", color: "#888894", fontSize: "13px", lineHeight: "1.6" }}>
                  Delete “{video.title}” permanently? The video and its
                  thumbnail are removed from cloud storage, along with its
                  likes, comments and bookmarks. This cannot be undone.
                </p>
              </div>

              <button
                type="button"
                onClick={closeDeleteDialog}
                disabled={deleteLoading}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#888894",
                  cursor: deleteLoading ? "wait" : "pointer",
                  fontSize: "22px",
                }}
              >
                ×
              </button>
            </div>

            {deleteError && (
              <p style={{ color: "#ff6b81", fontSize: "13px", margin: "13px 0 0" }}>
                {deleteError}
              </p>
            )}

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button
                type="button"
                onClick={closeDeleteDialog}
                disabled={deleteLoading}
                style={{
                  flex: 1,
                  padding: "13px 16px",
                  border: "1px solid #30303a",
                  borderRadius: "10px",
                  background: "transparent",
                  color: "#d8d8df",
                  fontWeight: "700",
                  cursor: deleteLoading ? "wait" : "pointer",
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={deleteLoading}
                style={{
                  flex: 1,
                  padding: "13px 16px",
                  border: "none",
                  borderRadius: "10px",
                  background: "linear-gradient(135deg, #e11d48, #f43f5e)",
                  color: "#ffffff",
                  fontWeight: "700",
                  cursor: deleteLoading ? "wait" : "pointer",
                  opacity: deleteLoading ? 0.7 : 1,
                }}
              >
                {deleteLoading ? "Deleting..." : "Delete permanently"}
              </button>
            </div>
          </form>
        </div>
      )}

      {reportDialogOpen && (
        <div
          onClick={closeReportDialog}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            background: "rgba(0,0,0,0.72)",
          }}
        >
          <form
            onSubmit={submitVideoReport}
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(440px, 100%)",
              padding: "24px",
              border: "1px solid #30303a",
              borderRadius: "16px",
              background: "#121217",
              boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "16px" }}>
              <div>
                <h3 style={{ margin: 0, color: "#ffffff" }}>Report video</h3>
                <p style={{ margin: "7px 0 0", color: "#888894", fontSize: "13px" }}>
                  Tell us why you are reporting “{video.title}”.
                </p>
              </div>

              <button
                type="button"
                onClick={closeReportDialog}
                disabled={reportLoading}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#888894",
                  cursor: reportLoading ? "wait" : "pointer",
                  fontSize: "22px",
                }}
              >
                ×
              </button>
            </div>

            <label style={{ display: "block", marginTop: "20px", marginBottom: "8px", color: "#d8d8df", fontSize: "13px" }}>
              Reason
            </label>

            <select
              value={reportReason}
              onChange={(event) => setReportReason(event.target.value)}
              disabled={reportLoading || Boolean(reportSuccess)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "13px 14px",
                borderRadius: "10px",
                border: "1px solid #30303a",
                background: "#18181f",
                color: "#ffffff",
                outline: "none",
              }}
            >
              <option value="">Select a reason</option>
              <option value="Spam or misleading">Spam or misleading</option>
              <option value="Harassment or bullying">Harassment or bullying</option>
              <option value="Hate or abusive content">Hate or abusive content</option>
              <option value="Violence or dangerous content">Violence or dangerous content</option>
              <option value="Sexual or inappropriate content">Sexual or inappropriate content</option>
              <option value="Copyright concern">Copyright concern</option>
              <option value="Other">Other</option>
            </select>

            {reportError && (
              <p style={{ color: "#ff6b81", fontSize: "13px", margin: "13px 0 0" }}>
                {reportError}
              </p>
            )}

            {reportSuccess && (
              <p style={{ color: "#68d391", fontSize: "13px", margin: "13px 0 0" }}>
                {reportSuccess}
              </p>
            )}

            <button
              type="submit"
              disabled={reportLoading || Boolean(reportSuccess)}
              style={{
                width: "100%",
                marginTop: "20px",
                padding: "13px 16px",
                border: "none",
                borderRadius: "10px",
                background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                color: "#ffffff",
                fontWeight: "700",
                cursor: reportLoading ? "wait" : "pointer",
                opacity: reportLoading || reportSuccess ? 0.7 : 1,
              }}
            >
              {reportLoading ? "Submitting report..." : reportSuccess ? "Reported" : "Submit report"}
            </button>
          </form>
        </div>
      )}
      {shareNote &&
        createPortal(
          <div
            role="status"
            style={{
              position: "fixed",
              left: "50%",
              bottom: "28px",
              transform: "translateX(-50%)",
              zIndex: 10000,
              maxWidth: "90vw",
              padding: "12px 20px",
              borderRadius: "999px",
              background: "linear-gradient(110deg, #7c3aed, #c026d3)",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: "700",
              boxShadow: "0 14px 40px rgba(124, 58, 237, 0.5)",
              wordBreak: "break-all",
            }}
          >
            {shareNote}
          </div>,
          document.body
        )}
    </article>
  );
}


// =====================================================
// VIDEO GRID
// =====================================================

function VideoGrid({
  videos,
  openVideo,
  openComments,
  commentsCount,
  likedVideos,
  onToggleLike,
  likeLoading,
  bookmarkedVideos,
  onToggleBookmark,
  bookmarkLoading,
}) {

  if (videos.length === 0) {

    return (
      <div className="feed-message">
        <p>
          No videos found.
        </p>
      </div>
    );

  }

  return (

    <div className="video-grid">

      {videos.map((video) => (

        <VideoCard
          key={video.id}
          video={video}
          openVideo={openVideo}
          openComments={openComments}
          commentsCount={commentsCount[video.id] || 0}
          liked={Boolean(likedVideos[video.id])}
          onToggleLike={onToggleLike}
          likeLoading={Boolean(likeLoading[video.id])}
          bookmarked={Boolean(bookmarkedVideos[video.id])}
          onToggleBookmark={onToggleBookmark}
          bookmarkLoading={Boolean(bookmarkLoading[video.id])}
        />

      ))}

    </div>

  );
}


// =====================================================
// SIMPLE PAGE
// =====================================================

function SimplePage({ title, description }) {
  return (
    <div
      style={{
        padding: "50px",
        minHeight: "70vh",
      }}
    >
      <span className="hero-label">✦ REELVERSE</span>

      <h2
        style={{
          marginTop: "20px",
          fontSize: "42px",
          color: "#ffffff",
        }}
      >
        {title}
      </h2>

      <p
        style={{
          marginTop: "15px",
          color: "#888894",
          fontSize: "16px",
          maxWidth: "600px",
          lineHeight: "1.7",
        }}
      >
        {description}
      </p>
    </div>
  );
}




// =====================================================
// NOTIFICATIONS PAGE - STEP 13B
// =====================================================

function NotificationsPage({
  authUser,
  onLoginNavigate,
  onUnreadStatusChange,
}) {
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openingNotificationId, setOpeningNotificationId] = useState(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);

  const token = localStorage.getItem("access_token");

  const loadNotifications = async () => {
    if (!authUser || !token) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/notifications", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json().catch(() => []);

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to load your notifications."
        );
      }

      const notificationData =
        Array.isArray(data) ? data : [];

      setNotifications(notificationData);

      onUnreadStatusChange?.(
        notificationData.some(
          (notification) => !notification.is_read
        )
      );
    } catch (err) {
      console.error("Notifications request failed:", err);
      setNotifications([]);
      setError(
        err.message || "Unable to load your notifications."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [authUser?.id]);

  const markNotificationRead = async (notification) => {
    if (!notification?.id || !token || notification.is_read) {
      return true;
    }

    const response = await fetch(
      `/api/notifications/${notification.id}/read`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message ||
          data.msg ||
          "Unable to mark the notification as read."
      );
    }

    setNotifications((currentNotifications) => {
      const updatedNotifications =
        currentNotifications.map((item) =>
          Number(item.id) === Number(notification.id)
            ? {
                ...item,
                is_read: true,
              }
            : item
        );

      onUnreadStatusChange?.(
        updatedNotifications.some(
          (item) => !item.is_read
        )
      );

      return updatedNotifications;
    });

    return true;
  };

  const openNotification = async (notification) => {
    if (!notification || openingNotificationId) {
      return;
    }

    try {
      setOpeningNotificationId(notification.id);
      setError("");

      await markNotificationRead(notification);

      if (
        notification.type === "message" &&
        notification.conversation_id
      ) {
        navigate(
          `/messages/${notification.conversation_id}`
        );
        return;
      }

      if (notification.sender_id) {
        navigate(`/users/${notification.sender_id}`);
      }
    } catch (err) {
      console.error("Open notification failed:", err);
      setError(
        err.message || "Unable to open this notification."
      );
    } finally {
      setOpeningNotificationId(null);
    }
  };

  const markAllAsRead = async () => {
    if (!token || markingAllRead) {
      return;
    }

    try {
      setMarkingAllRead(true);
      setError("");

      const response = await fetch(
        "/api/notifications/read-all",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to mark notifications as read."
        );
      }

      setNotifications((currentNotifications) =>
        currentNotifications.map((notification) => ({
          ...notification,
          is_read: true,
        }))
      );

      onUnreadStatusChange?.(false);
    } catch (err) {
      console.error("Mark all notifications read failed:", err);
      setError(
        err.message || "Unable to mark notifications as read."
      );
    } finally {
      setMarkingAllRead(false);
    }
  };

  if (!authUser) {
    return (
      <div
        style={{
          minHeight: "65vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "50px 20px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "520px" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>
            🔔
          </div>

          <h2 style={{ color: "#ffffff", margin: 0 }}>
            Notifications
          </h2>

          <p
            style={{
              color: "#888894",
              lineHeight: "1.6",
              margin: "12px 0 22px",
            }}
          >
            Login to view your ReelVerse notifications.
          </p>

          <button
            type="button"
            onClick={onLoginNavigate}
            style={authPrimaryButtonStyle}
          >
            Login to continue
          </button>
        </div>
      </div>
    );
  }

  const unreadCount = notifications.filter(
    (notification) => !notification.is_read
  ).length;

  return (
    <div className="rv-page" style={{ padding: "40px 50px 70px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "26px",
        }}
      >
        <div>
          <span className="hero-label">
            ✦ REELVERSE ACTIVITY
          </span>

          <h2
            style={{
              margin: "14px 0 7px",
              fontSize: "40px",
              color: "#ffffff",
            }}
          >
            Notifications
          </h2>

          <p
            style={{
              margin: 0,
              color: "#888894",
              fontSize: "14px",
            }}
          >
            {unreadCount > 0
              ? `${unreadCount} unread notification${
                  unreadCount !== 1 ? "s" : ""
                }`
              : "You're all caught up."}
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllAsRead}
            disabled={markingAllRead}
            style={{
              ...authPrimaryButtonStyle,
              width: "auto",
              minWidth: "150px",
              opacity: markingAllRead ? 0.7 : 1,
              cursor: markingAllRead ? "wait" : "pointer",
            }}
          >
            {markingAllRead
              ? "Updating..."
              : "Mark all as read"}
          </button>
        )}
      </div>

      {error && (
        <div
          className="feed-message error-message"
          style={{ marginBottom: "18px" }}
        >
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="feed-message">
          <div className="loading-spinner"></div>
          <p>Loading notifications...</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className="feed-message">
          <div style={{ fontSize: "40px", marginBottom: "10px" }}>
            🔔
          </div>
          <p>No notifications yet.</p>
          <small>
            Your ReelVerse activity will appear here.
          </small>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            maxWidth: "900px",
          }}
        >
          {notifications.map((notification) => {
            const isMessage =
              notification.type === "message" &&
              Boolean(notification.conversation_id);

            const isOpening =
              Number(openingNotificationId) ===
              Number(notification.id);

            return (
              <button
                key={notification.id}
                type="button"
                onClick={() => openNotification(notification)}
                disabled={isOpening}
                style={{
                  width: "100%",
                  border: notification.is_read
                    ? "1px solid #292932"
                    : "1px solid #6d45a8",
                  borderRadius: "14px",
                  background: notification.is_read
                    ? "#111116"
                    : "linear-gradient(135deg, rgba(124,58,237,0.17), rgba(17,17,22,0.98))",
                  padding: "16px 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  textAlign: "left",
                  cursor: isOpening ? "wait" : "pointer",
                  opacity: isOpening ? 0.75 : 1,
                  color: "inherit",
                }}
              >
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "50%",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isMessage
                      ? "rgba(124,58,237,0.20)"
                      : "#1a1a21",
                    border: "1px solid #343440",
                    fontSize: "19px",
                  }}
                >
                  {isMessage ? "✉" : "🔔"}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      color: "#ffffff",
                      fontSize: "14px",
                      lineHeight: "1.5",
                      fontWeight: notification.is_read ? "500" : "750",
                    }}
                  >
                    {notification.message ||
                      "You have a new notification."}
                  </div>

                  <div
                    style={{
                      marginTop: "5px",
                      color: "#777783",
                      fontSize: "11px",
                    }}
                  >
                    {notification.created_at
                      ? new Date(
                          notification.created_at
                        ).toLocaleString()
                      : ""}
                    {isMessage ? " • Open chat" : ""}
                  </div>
                </div>

                {!notification.is_read && (
                  <span
                    title="Unread"
                    style={{
                      width: "9px",
                      height: "9px",
                      borderRadius: "50%",
                      background: "#a855f7",
                      flexShrink: 0,
                    }}
                  />
                )}

                <span
                  style={{
                    color: "#777783",
                    fontSize: "18px",
                    flexShrink: 0,
                  }}
                >
                  ›
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


// =====================================================
// UPLOAD VIDEO PAGE - STEP 1 (UI ONLY)
// =====================================================

// Sends a form with upload progress (fetch cannot report progress).
function postWithProgress(path, formData, token, onProgress) {
  const base = String(import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
  const url = base ? `${base}${path}` : `/api${path}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded, event.total);
      }
    };

    xhr.onload = () => {
      let data = {};

      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = {};
      }

      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        data,
      });
    };

    xhr.onerror = () =>
      reject(
        new Error(
          "Network error while uploading. Check your connection and try again."
        )
      );

    xhr.send(formData);
  });
}


// Videos at or above this size go straight from the browser to R2.
const DIRECT_UPLOAD_MIN_BYTES = 50 * 1024 * 1024;

const DIRECT_PARALLEL_PARTS = 3;
const DIRECT_PART_ATTEMPTS = 6;


// Sends one part of a big video to R2 and returns its ETag.
function putPartToR2(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("PUT", url);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag");

        if (etag) {
          resolve(etag);
        } else {
          reject(
            new Error(
              "Storage did not return the part ID. The R2 CORS setting must expose ETag."
            )
          );
        }
      } else {
        reject(new Error(`Storage answered with status ${xhr.status}.`));
      }
    };

    xhr.onerror = () =>
      reject(new Error("Network problem while uploading a part."));

    xhr.send(blob);
  });
}


async function putPartWithRetries(url, blob, onProgress) {
  for (let attempt = 1; attempt <= DIRECT_PART_ATTEMPTS; attempt += 1) {
    try {
      return await putPartToR2(url, blob, onProgress);
    } catch (error) {
      onProgress(0);

      if (attempt === DIRECT_PART_ATTEMPTS) {
        throw error;
      }

      // Short internet drops: wait a little longer each time.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(30000, 1500 * 2 ** attempt))
      );
    }
  }

  return null;
}


// Uploads a big video straight to R2 in parts, with live progress.
async function uploadVideoDirect(file, getToken, onProgress) {
  const startResponse = await fetch("/api/videos/direct/start", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename: file.name, size: file.size }),
  });

  const start = await startResponse.json().catch(() => ({}));

  if (!startResponse.ok) {
    throw new Error(start.message || "Could not start the upload.");
  }

  const { key, upload_id: uploadId, part_size: partSize } = start;
  const urls = start.part_urls;

  const loadedByPart = new Array(urls.length).fill(0);
  const parts = new Array(urls.length);

  const report = () => {
    const loaded = loadedByPart.reduce((sum, value) => sum + value, 0);
    onProgress(Math.min(loaded, file.size), file.size);
  };

  let nextIndex = 0;
  let failure = null;

  const worker = async () => {
    while (!failure) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= urls.length) {
        return;
      }

      const blob = file.slice(
        index * partSize,
        Math.min(file.size, (index + 1) * partSize)
      );

      try {
        const etag = await putPartWithRetries(urls[index], blob, (loaded) => {
          loadedByPart[index] = loaded;
          report();
        });

        loadedByPart[index] = blob.size;
        parts[index] = { PartNumber: index + 1, ETag: etag };
        report();
      } catch (error) {
        failure = error;
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(DIRECT_PARALLEL_PARTS, urls.length) },
      worker
    )
  );

  if (failure) {
    // Tell the server to clean up the unfinished upload.
    try {
      await fetch("/api/videos/direct/abort", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await getToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key, upload_id: uploadId }),
      });
    } catch {
      // Nothing more to do.
    }

    throw failure;
  }

  return { key, uploadId, parts };
}


function UploadPage({ authUser, onLoginNavigate }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [videoFile, setVideoFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadSizes, setUploadSizes] = useState({ loaded: 0, total: 0 });
  const [uploadError, setUploadError] = useState("");

  // Warn before the page is closed while a video is still uploading.
  useEffect(() => {
    if (!uploading) {
      return undefined;
    }

    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warn);

    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  if (!authUser) {
    return (
      <div
        style={{
          minHeight: "65vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "50px 20px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "520px" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>↥</div>
          <h2 style={{ color: "#ffffff", margin: 0 }}>Upload to ReelVerse</h2>
          <p
            style={{
              color: "#888894",
              lineHeight: "1.6",
              margin: "12px 0 22px",
            }}
          >
            Login to upload your videos to ReelVerse.
          </p>
          <button
            type="button"
            onClick={onLoginNavigate}
            style={authPrimaryButtonStyle}
          >
            Login to continue
          </button>
        </div>
      </div>
    );
  }





  const handleSubmit = async (event) => {
    event.preventDefault();

    const token = localStorage.getItem("access_token");

    if (!token) {
      setUploadError("Your login session is missing. Please login again.");
      return;
    }

    if (!videoFile || !thumbnailFile) {
      setUploadError("Please choose both a video file and a thumbnail image.");
      return;
    }

    const formData = new FormData();
    formData.append("title", title.trim());
    formData.append("description", description.trim());
    formData.append("category", category);
    formData.append("video", videoFile);
    formData.append("thumbnail", thumbnailFile);

    try {
      setUploading(true);
      setUploadError("");
      setMessage("");

      setUploadPercent(0);
      setUploadSizes({ loaded: 0, total: 0 });

      const getToken = async () =>
        (window.__reelverseFreshToken
          ? await window.__reelverseFreshToken()
          : null) || localStorage.getItem("access_token") || token;

      const onProgress = (loaded, total) => {
        setUploadSizes({ loaded, total });
        setUploadPercent(Math.min(100, Math.round((loaded / total) * 100)));
      };

      let response;

      if (videoFile.size >= DIRECT_UPLOAD_MIN_BYTES) {
        // Big video: straight to R2 in parts, then save the details.
        const sent = await uploadVideoDirect(videoFile, getToken, onProgress);

        setUploadPercent(100);

        const finishForm = new FormData();
        finishForm.append("title", title.trim());
        finishForm.append("description", description.trim());
        finishForm.append("category", category);
        finishForm.append("key", sent.key);
        finishForm.append("upload_id", sent.uploadId);
        finishForm.append("parts", JSON.stringify(sent.parts));
        finishForm.append("thumbnail", thumbnailFile);

        const finishResponse = await fetch("/api/videos/direct/complete", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await getToken()}`,
          },
          body: finishForm,
        });

        response = {
          ok: finishResponse.ok,
          data: await finishResponse.json().catch(() => ({})),
        };
      } else {
        response = await postWithProgress(
          "/videos",
          formData,
          await getToken(),
          onProgress
        );
      }

      const data = response.data || {};

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            data.error ||
            "Video upload failed."
        );
      }

      setMessage("Video uploaded successfully! Opening My Videos...");

      setTitle("");
      setDescription("");
      setCategory("");
      setVideoFile(null);
      setThumbnailFile(null);

      setTimeout(() => {
        navigate("/my-videos");
      }, 700);
    } catch (err) {
      console.error("Video upload failed:", err);
      setUploadError(
        err.message || "Unable to upload the video."
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rv-page" style={{ padding: "40px 50px 70px" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>
        <span className="hero-label">✦ CREATE ON REELVERSE</span>

        <h2
          style={{
            margin: "15px 0 8px",
            fontSize: "40px",
            color: "#ffffff",
          }}
        >
          Upload Video
        </h2>

        <p
          style={{
            margin: "0 0 28px",
            color: "#888894",
            fontSize: "15px",
            lineHeight: "1.6",
          }}
        >
          Add your video details, choose a video file and thumbnail, then publish it to ReelVerse.
        </p>

        <form
          className="rv-upload-form"
          onSubmit={handleSubmit}
          style={{
            background: "linear-gradient(135deg, #15121c, #101015)",
            border: "1px solid #292932",
            borderRadius: "18px",
            padding: "28px",
          }}
        >
          <label style={authLabelStyle}>Title</label>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Enter your video title"
            required
            style={authInputStyle}
          />

          <label style={authLabelStyle}>Description</label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Tell viewers about your video"
            rows={5}
            required
            style={{
              ...authInputStyle,
              resize: "vertical",
              minHeight: "120px",
            }}
          />

          <label style={authLabelStyle}>Category</label>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            required
            style={authInputStyle}
          >
            <option value="">Select a category</option>
            <option value="Education">Education</option>
            <option value="Entertainment">Entertainment</option>
            <option value="Short Films">Short Films</option>
            <option value="Comedy">Comedy</option>
            <option value="Technology">Technology</option>
            <option value="Other">Other</option>
          </select>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "16px",
              marginTop: "6px",
            }}
          >
            <div>
              <label style={authLabelStyle}>Video file</label>
              <div
                style={{
                  border: "1px dashed #3b3b47",
                  borderRadius: "12px",
                  padding: "18px",
                  background: "#111116",
                }}
              >
                <input
                  type="file"
                  accept="video/*"
                  required
                  onChange={(event) =>
                    setVideoFile(event.target.files?.[0] || null)
                  }
                  style={{ color: "#cfcfd7", width: "100%" }}
                />
                <p
                  style={{
                    margin: "10px 0 0",
                    color: "#777783",
                    fontSize: "12px",
                    wordBreak: "break-word",
                  }}
                >
                  {videoFile ? videoFile.name : "Choose the video you want to upload."}
                </p>
              </div>
            </div>

            <div>
              <label style={authLabelStyle}>Thumbnail image</label>
              <div
                style={{
                  border: "1px dashed #3b3b47",
                  borderRadius: "12px",
                  padding: "18px",
                  background: "#111116",
                }}
              >
                <input
                  type="file"
                  accept="image/*"
                  required
                  onChange={(event) =>
                    setThumbnailFile(event.target.files?.[0] || null)
                  }
                  style={{ color: "#cfcfd7", width: "100%" }}
                />
                <p
                  style={{
                    margin: "10px 0 0",
                    color: "#777783",
                    fontSize: "12px",
                    wordBreak: "break-word",
                  }}
                >
                  {thumbnailFile
                    ? thumbnailFile.name
                    : "Choose an image that represents your video."}
                </p>
              </div>
            </div>
          </div>

          {uploadError && (
            <div
              style={{
                marginTop: "18px",
                padding: "12px 14px",
                borderRadius: "10px",
                border: "1px solid #5a2730",
                background: "#211116",
                color: "#ff8a9b",
                fontSize: "13px",
                lineHeight: "1.5",
              }}
            >
              {uploadError}
            </div>
          )}

          {message && (
            <div
              style={{
                marginTop: "18px",
                padding: "12px 14px",
                borderRadius: "10px",
                border: "1px solid #3c3150",
                background: "#171220",
                color: "#c4a7ff",
                fontSize: "13px",
                lineHeight: "1.5",
              }}
            >
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={uploading}
            style={{
              ...authPrimaryButtonStyle,
              marginTop: "22px",
              width: "100%",
              opacity: uploading ? 0.7 : 1,
              cursor: uploading ? "wait" : "pointer",
            }}
          >
            {uploading
              ? uploadPercent >= 100
                ? "Finishing on the server..."
                : `Uploading... ${uploadPercent}%`
              : "Upload Video"}
          </button>

          {uploading && (
            <div style={{ marginTop: "14px" }}>
              <div
                style={{
                  height: "8px",
                  borderRadius: "999px",
                  background: "#2a2438",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${uploadPercent}%`,
                    height: "100%",
                    borderRadius: "999px",
                    background: "linear-gradient(90deg, #7c3aed, #c084fc)",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>

              <div
                style={{
                  marginTop: "8px",
                  fontSize: "12px",
                  color: "#a9a3bd",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  {(uploadSizes.loaded / 1048576).toFixed(1)} MB of{" "}
                  {(uploadSizes.total / 1048576).toFixed(1)} MB
                </span>
                <span>
                  {uploadPercent >= 100
                    ? "Saving video, please keep this page open"
                    : `${uploadPercent}%`}
                </span>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}


// =====================================================
// PROFILE PAGE - PROFILE SETTINGS STEP P5A
// =====================================================

// =====================================================
// COVER PHOTO CROP EDITOR (wide landscape banner, like YouTube)
// =====================================================

const COVER_ASPECT = 6; // width : height of the banner
const COVER_OUTPUT_WIDTH = 1920;

const COVER_CROP_CSS = `
.rv-cc-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(5, 4, 12, 0.82);
  backdrop-filter: blur(10px);
  animation: rv-cc-fade 0.2s ease;
}

@keyframes rv-cc-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.rv-cc-modal {
  width: min(94vw, 880px);
  max-height: 94vh;
  overflow-y: auto;
  padding: 24px;
  border-radius: 20px;
  border: 1px solid rgba(167, 139, 250, 0.28);
  background: linear-gradient(160deg, #17122a, #0e0c18);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.6);
  color: #fff;
  font-family: Inter, system-ui, sans-serif;
}

.rv-cc-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.rv-cc-head h3 {
  margin: 0;
  font-family: var(--rv-marquee);
  font-weight: 400;
  font-size: 30px;
  letter-spacing: 1.5px;
}

.rv-cc-head p {
  margin: 4px 0 0;
  color: #a8a3b8;
  font-size: 13px;
}

.rv-cc-x {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font-size: 20px;
  cursor: pointer;
}

.rv-cc-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 6 / 1;
  overflow: hidden;
  border-radius: 12px;
  background: #07060d;
  border: 2px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), 0 0 40px rgba(124, 58, 237, 0.3);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.rv-cc-frame.rv-cc-dragging {
  cursor: grabbing;
}

.rv-cc-frame img {
  position: absolute;
  max-width: none;
  max-height: none;
  pointer-events: none;
  user-select: none;
}

.rv-cc-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(90deg, transparent 33.2%, rgba(255, 255, 255, 0.28) 33.3%, transparent 33.5%, transparent 66.5%, rgba(255, 255, 255, 0.28) 66.6%, transparent 66.8%),
    linear-gradient(0deg, transparent 49.5%, rgba(255, 255, 255, 0.18) 50%, transparent 50.5%);
  opacity: 0;
  transition: opacity 0.2s;
}

.rv-cc-dragging .rv-cc-grid,
.rv-cc-frame:hover .rv-cc-grid {
  opacity: 1;
}

.rv-cc-hint {
  margin: 10px 0 0;
  color: #8f8aa3;
  font-size: 12.5px;
}

.rv-cc-warn {
  margin: 10px 0 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(250, 204, 21, 0.1);
  border: 1px solid rgba(250, 204, 21, 0.35);
  color: #fde68a;
  font-size: 12.5px;
}

.rv-cc-label {
  display: block;
  margin: 20px 0 8px;
  color: #b9b4cf;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.rv-cc-range {
  width: 100%;
  accent-color: #8b5cf6;
}

.rv-cc-error {
  margin: 14px 0 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(60, 10, 20, 0.7);
  border: 1px solid rgba(248, 113, 113, 0.5);
  color: #fecaca;
  font-size: 13px;
}

.rv-cc-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 22px;
}

.rv-cc-spacer {
  flex: 1;
}

.rv-cc-btn {
  height: 42px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
}

.rv-cc-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
  transform: translateY(-1px);
}

.rv-cc-primary {
  border: none;
  background: linear-gradient(110deg, #7c3aed, #c026d3 60%, #ec4899);
  box-shadow: 0 10px 26px rgba(168, 85, 247, 0.4);
}

.rv-cc-primary:hover:not(:disabled) {
  background: linear-gradient(110deg, #8b5cf6, #d946ef 60%, #f472b6);
}

.rv-cc-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

@media (max-width: 640px) {
  .rv-cc-modal {
    padding: 18px 16px;
  }
}

`;

function CoverCropModal({ file, busy, onCancel, onConfirm }) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);

  const [imageUrl, setImageUrl] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [fx, setFx] = useState(0.5);
  const [fy, setFy] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setSize({ width: 0, height: 0 });
    setZoom(1);
    setFx(0.5);
    setFy(0.5);
    setError("");

    return () => URL.revokeObjectURL(url);
  }, [file]);

  const imageWidth = size.width || 1;
  const imageHeight = size.height || 1;

  // How big the picture is, as a % of the frame, when zoom is 1.
  const widthPct =
    Math.max(1, imageWidth / imageHeight / COVER_ASPECT) * zoom * 100;
  const heightPct =
    Math.max(1, (COVER_ASPECT * imageHeight) / imageWidth) * zoom * 100;

  const lowResolution = size.width > 0 && size.width < 1200;

  const clamp01 = (value) => Math.min(1, Math.max(0, value));

  const handlePointerDown = (event) => {
    if (!frameRef.current) {
      return;
    }

    frameRef.current.setPointerCapture?.(event.pointerId);

    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      fx,
      fy,
    };

    setDragging(true);
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    const frame = frameRef.current;

    if (!drag || !frame) {
      return;
    }

    const rect = frame.getBoundingClientRect();
    const rangeX = (rect.width * (widthPct - 100)) / 100;
    const rangeY = (rect.height * (heightPct - 100)) / 100;

    if (rangeX > 0) {
      setFx(clamp01(drag.fx - (event.clientX - drag.x) / rangeX));
    }

    if (rangeY > 0) {
      setFy(clamp01(drag.fy - (event.clientY - drag.y) / rangeY));
    }
  };

  const handlePointerUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const handleSave = async () => {
    if (busy || !size.width) {
      return;
    }

    try {
      setError("");

      const image = new Image();

      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = imageUrl;
      });

      const sourceWidth = (imageWidth * 100) / widthPct;
      const sourceHeight = (imageHeight * 100) / heightPct;
      const sourceX = (imageWidth - sourceWidth) * fx;
      const sourceY = (imageHeight - sourceHeight) * fy;

      const canvas = document.createElement("canvas");
      canvas.width = COVER_OUTPUT_WIDTH;
      canvas.height = Math.round(COVER_OUTPUT_WIDTH / COVER_ASPECT);

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Unable to prepare the cover image.");
      }

      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.92);
      });

      if (!blob) {
        throw new Error("Unable to create the cover image.");
      }

      const baseName = (file.name || "cover").replace(/\.[^/.]+$/, "");

      onConfirm(
        new File([blob], `${baseName}-cover.jpg`, { type: "image/jpeg" })
      );
    } catch (err) {
      console.error("Cover crop failed:", err);
      setError(err.message || "Unable to crop this image.");
    }
  };

  return createPortal(
    <div
      className="rv-cc-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div className="rv-cc-modal" role="dialog" aria-label="Crop cover photo">
        <style>{COVER_CROP_CSS}</style>
        <div className="rv-cc-head">
          <div>
            <h3>Adjust your cover photo</h3>
            <p>
              Drag the picture to reposition it, and use the slider to zoom.
            </p>
          </div>

          <button
            type="button"
            className="rv-cc-x"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div
          ref={frameRef}
          className={`rv-cc-frame ${dragging ? "rv-cc-dragging" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {imageUrl && (
            <img
              src={imageUrl}
              alt="Cover preview"
              draggable="false"
              onLoad={(event) =>
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              style={{
                width: `${widthPct}%`,
                height: `${heightPct}%`,
                left: `${-(widthPct - 100) * fx}%`,
                top: `${-(heightPct - 100) * fy}%`,
              }}
            />
          )}

          <span className="rv-cc-grid" aria-hidden="true"></span>
        </div>

        <p className="rv-cc-hint">
          Preview of how your banner will look. Best results: a wide
          landscape image, about 2560 × 427 px.
        </p>

        {lowResolution && (
          <p className="rv-cc-warn">
            This image is small ({size.width}px wide) and may look blurry
            on large screens.
          </p>
        )}

        <label className="rv-cc-label">
          Zoom — {zoom.toFixed(1)}×
        </label>
        <input
          type="range"
          min="1"
          max="4"
          step="0.05"
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="rv-cc-range"
        />

        {error && <p className="rv-cc-error">{error}</p>}

        <div className="rv-cc-actions">
          <button
            type="button"
            className="rv-cc-btn"
            onClick={() => {
              setZoom(1);
              setFx(0.5);
              setFy(0.5);
            }}
            disabled={busy}
          >
            Reset
          </button>

          <span className="rv-cc-spacer"></span>

          <button
            type="button"
            className="rv-cc-btn"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>

          <button
            type="button"
            className="rv-cc-btn rv-cc-primary"
            onClick={handleSave}
            disabled={busy || !size.width}
          >
            {busy ? "Uploading..." : "Save cover"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// =====================================================
// EMAIL CHANGE: send a code to the new address and check it
// =====================================================

function EmailVerifyBox({ newEmail, verified, onVerified }) {
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) {
      return undefined;
    }

    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);

    return () => clearTimeout(timer);
  }, [cooldown]);

  const callServer = async (path, body) => {
    const response = await fetch(`/api/users/email-change/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("access_token")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || data.msg || "Something went wrong.");
    }

    return data;
  };

  const sendCode = async () => {
    if (busy || cooldown > 0) {
      return;
    }

    if (!newEmail.includes("@") || !newEmail.includes(".")) {
      setError("Please enter a valid email address first.");
      return;
    }

    try {
      setBusy(true);
      setError("");
      setInfo("");

      await callServer("send-code", { email: newEmail });

      setCodeSent(true);
      setCode("");
      setCooldown(30);
      setInfo(`We sent a 6-digit code to ${newEmail}. It expires in 10 minutes.`);
    } catch (err) {
      setError(err.message || "Could not send the code.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (busy) {
      return;
    }

    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your email.");
      return;
    }

    try {
      setBusy(true);
      setError("");

      await callServer("verify", { email: newEmail, code: code.trim() });

      onVerified(newEmail);
    } catch (err) {
      setError(err.message || "Could not verify the code.");
    } finally {
      setBusy(false);
    }
  };

  const smallButton = {
    padding: "10px 16px",
    borderRadius: "8px",
    border: "1px solid #4c3a7a",
    background: "#2a1d4a",
    color: "#e4d7ff",
    fontWeight: "700",
    fontSize: "13px",
    cursor: busy ? "wait" : "pointer",
    whiteSpace: "nowrap",
  };

  if (verified) {
    return (
      <p style={{ ...authSuccessStyle, marginTop: "10px" }}>
        ✓ New email verified. Press Save Changes to finish.
      </p>
    );
  }

  return (
    <div
      style={{
        marginTop: "10px",
        padding: "12px 14px",
        borderRadius: "10px",
        border: "1px solid #3c3150",
        background: "#171220",
      }}
    >
      <p style={{ margin: "0 0 10px", color: "#c4a7ff", fontSize: "13px" }}>
        To change your email, verify the new address first.
      </p>

      {!codeSent ? (
        <button
          type="button"
          onClick={sendCode}
          disabled={busy}
          style={smallButton}
        >
          {busy ? "Sending..." : "Send verification code"}
        </button>
      ) : (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            placeholder="6-digit code"
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                verifyCode();
              }
            }}
            style={{
              ...authInputStyle,
              flex: "1 1 130px",
              width: "auto",
              minWidth: "120px",
              letterSpacing: "4px",
            }}
          />

          <button
            type="button"
            onClick={verifyCode}
            disabled={busy}
            style={smallButton}
          >
            {busy ? "Checking..." : "Verify"}
          </button>

          <button
            type="button"
            onClick={sendCode}
            disabled={busy || cooldown > 0}
            style={{
              ...smallButton,
              background: "transparent",
              opacity: cooldown > 0 ? 0.6 : 1,
            }}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </div>
      )}

      {info && (
        <p style={{ margin: "10px 0 0", color: "#a9a3bd", fontSize: "12px" }}>
          {info}
        </p>
      )}

      {error && (
        <p style={{ margin: "10px 0 0", color: "#ff6b81", fontSize: "13px" }}>
          {error}
        </p>
      )}
    </div>
  );
}


function ProfilePage({ authUser, videos, openVideo, onLoginNavigate, onAuthUserUpdate }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  // STEP P6E-1: Followers list
  const [followersList, setFollowersList] = useState([]);
  const [showFollowersList, setShowFollowersList] = useState(false);

  // STEP P6E-2: Following list
  const [followingList, setFollowingList] = useState([]);
  const [showFollowingList, setShowFollowingList] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // STEP P5A: Profile Settings UI only
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  // The new email address that has been checked with a code.
  const [verifiedNewEmail, setVerifiedNewEmail] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editWebsiteUrl, setEditWebsiteUrl] = useState("");
  const [editYoutubeUrl, setEditYoutubeUrl] = useState("");
  const [editInstagramUrl, setEditInstagramUrl] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState("");
  const [profileSaveMessage, setProfileSaveMessage] = useState("");
  const [profileShareMessage, setProfileShareMessage] = useState("");
  const [profilePhotoFile, setProfilePhotoFile] = useState(null);
  const [profilePhotoUploading, setProfilePhotoUploading] = useState(false);
  const [profilePhotoRemoving, setProfilePhotoRemoving] = useState(false);
  const [profilePhotoError, setProfilePhotoError] = useState("");
  const [profilePhotoMessage, setProfilePhotoMessage] = useState("");

  // Cover photo (wide banner on top of the profile card)
  const [coverUrl, setCoverUrl] = useState("");
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState("");
  const coverInputRef = useRef(null);
  const [coverCropFile, setCoverCropFile] = useState(null);

  // STEP P5E: Profile photo crop
  const [cropImageUrl, setCropImageUrl] = useState("");
  const [cropImageFile, setCropImageFile] = useState(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropX, setCropX] = useState(50);
  const [cropY, setCropY] = useState(50);
  const [cropImageDimensions, setCropImageDimensions] = useState({
    width: 0,
    height: 0,
  });
  const [cropProcessing, setCropProcessing] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      if (!authUser?.id) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");

        const [profileResponse, followersResponse, followingResponse] =
          await Promise.all([
            fetch(`/api/users/${authUser.id}`),
            fetch(`/api/users/${authUser.id}/followers`),
            fetch(`/api/users/${authUser.id}/following`),
          ]);

        const profileData = await profileResponse.json().catch(() => ({}));
        const followersData = await followersResponse.json().catch(() => ({}));
        const followingData = await followingResponse.json().catch(() => ({}));

        if (!profileResponse.ok) {
          throw new Error(
            profileData.message ||
              profileData.msg ||
              "Unable to load your profile."
          );
        }

        setProfile(profileData);
        setFollowersCount(followersData.total_followers || 0);
        setFollowingCount(followingData.total_following || 0);

        // The cover photo is optional, so a failure here is ignored.
        fetch(`/api/users/${authUser.id}/cover`)
          .then((coverResponse) => coverResponse.json())
          .then((coverData) =>
            setCoverUrl(coverData.cover_photo_url || "")
          )
          .catch(() => {});

        setFollowersList(
          Array.isArray(followersData.followers)
            ? followersData.followers
            : []
        );
        setFollowingList(
          Array.isArray(followingData.following)
            ? followingData.following
            : []
        );

        setEditUsername(profileData.username || "");
        setEditEmail(profileData.email || "");
        setEditBio(profileData.bio || "");
        setEditWebsiteUrl(profileData.website_url || "");
        setEditYoutubeUrl(profileData.youtube_url || "");
        setEditInstagramUrl(profileData.instagram_url || "");
      } catch (err) {
        console.error("Profile request failed:", err);
        setError(err.message || "Unable to load your profile.");
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [authUser]);

  // Step 1: the user picks a picture -> open the crop editor.
  const handleCoverFileChange = (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setCoverError("Only JPG, PNG and WEBP images are allowed.");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setCoverError("Please choose an image smaller than 20 MB.");
      return;
    }

    setCoverError("");
    setCoverCropFile(file);
  };

  // Step 2: the cropped picture is uploaded.
  const uploadCoverFile = async (file) => {
    const token = localStorage.getItem("access_token");

    if (!token) {
      setCoverCropFile(null);
      setCoverError("Your login session is missing. Please login again.");
      return;
    }

    const formData = new FormData();
    formData.append("cover", file);

    try {
      setCoverBusy(true);
      setCoverError("");

      const response = await fetch("/api/users/profile/cover", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || data.msg || "Unable to upload the cover photo."
        );
      }

      setCoverUrl(data.cover_photo_url || "");
      setCoverCropFile(null);
    } catch (err) {
      console.error("Cover upload failed:", err);
      setCoverCropFile(null);
      setCoverError(err.message || "Unable to upload the cover photo.");
    } finally {
      setCoverBusy(false);
    }
  };

  const handleCoverRemove = async () => {
    const token = localStorage.getItem("access_token");

    if (!token || coverBusy) {
      return;
    }

    try {
      setCoverBusy(true);
      setCoverError("");

      const response = await fetch("/api/users/profile/cover", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || data.msg || "Unable to remove the cover photo."
        );
      }

      setCoverUrl("");
    } catch (err) {
      setCoverError(err.message || "Unable to remove the cover photo.");
    } finally {
      setCoverBusy(false);
    }
  };

  const openEditProfile = () => {
    setEditUsername(profile?.username || authUser?.username || "");
    setEditEmail(profile?.email || authUser?.email || "");
    setEditBio(profile?.bio || "");
    setEditWebsiteUrl(profile?.website_url || "");
    setEditYoutubeUrl(profile?.youtube_url || "");
    setEditInstagramUrl(profile?.instagram_url || "");
    setProfileSaveError("");
    setProfileSaveMessage("");
    setVerifiedNewEmail("");
    setShowEditProfile(true);
  };

  const closeEditProfile = () => {
    setEditUsername(profile?.username || authUser?.username || "");
    setEditEmail(profile?.email || authUser?.email || "");
    setEditBio(profile?.bio || "");
    setEditWebsiteUrl(profile?.website_url || "");
    setEditYoutubeUrl(profile?.youtube_url || "");
    setEditInstagramUrl(profile?.instagram_url || "");
    setProfileSaveError("");
    setProfileSaveMessage("");
    setVerifiedNewEmail("");
    setShowEditProfile(false);
  };

  const handleProfileSave = async () => {
    if (profileSaving) {
      return;
    }

    const token = localStorage.getItem("access_token");

    if (!token) {
      setProfileSaveError("Your login session is missing. Please login again.");
      return;
    }

    const username = editUsername.trim();
    const email = editEmail.trim();
    const bio = editBio.trim();
    const website_url = editWebsiteUrl.trim();
    const youtube_url = editYoutubeUrl.trim();
    const instagram_url = editInstagramUrl.trim();

    if (!username) {
      setProfileSaveError("Username cannot be empty.");
      return;
    }

    if (!email) {
      setProfileSaveError("Email cannot be empty.");
      return;
    }

    const currentEmail = (
      profile?.email ||
      authUser?.email ||
      ""
    ).trim().toLowerCase();

    if (
      email.toLowerCase() !== currentEmail &&
      verifiedNewEmail !== email.toLowerCase()
    ) {
      setProfileSaveError(
        "Please verify your new email address with the code before saving."
      );
      return;
    }

    try {
      setProfileSaving(true);
      setProfileSaveError("");
      setProfileSaveMessage("");

      const response = await fetch("/api/users/profile", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          email,
          bio,
          website_url,
          youtube_url,
          instagram_url,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        let errorMessage =
          data.message ||
          data.msg ||
          "Unable to update your profile.";

        if (errorMessage === "Username already exists.") {
          errorMessage =
            "Username already exists. Please try another username.";
        } else if (errorMessage === "Email already exists.") {
          errorMessage =
            "Email already exists. Please try another email.";
        }

        throw new Error(errorMessage);
      }

      const updatedUser = data.user || {};

      setProfile((currentProfile) => ({
        ...(currentProfile || {}),
        ...updatedUser,
      }));

      onAuthUserUpdate?.(updatedUser);

      setEditUsername(updatedUser.username || username);
      setEditEmail(updatedUser.email || email);
      setVerifiedNewEmail("");
      setEditBio(updatedUser.bio || "");
      setEditWebsiteUrl(updatedUser.website_url || "");
      setEditYoutubeUrl(updatedUser.youtube_url || "");
      setEditInstagramUrl(updatedUser.instagram_url || "");

      setProfileSaveMessage(
        data.message || "Profile updated successfully!"
      );
    } catch (err) {
      console.error("Profile update failed:", err);
      setProfileSaveError(
        err.message || "Unable to update your profile."
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const handleShareProfile = async () => {
    if (!authUser?.id) {
      return;
    }

    const name = profile?.username || authUser.username || "this creator";

    setProfileShareMessage("");

    const message = await shareLink({
      title: `${name} on ReelVerse`,
      text: `Check out ${name}'s profile on ReelVerse.`,
      url: `${window.location.origin}/users/${authUser.id}`,
      copiedMessage: "Profile link copied!",
    });

    if (message) {
      setProfileShareMessage(message);
    }
  };

  const closeCropEditor = () => {
    if (cropImageUrl) {
      URL.revokeObjectURL(cropImageUrl);
    }

    setCropImageUrl("");
    setCropImageFile(null);
    setCropImageDimensions({ width: 0, height: 0 });
    setCropZoom(1);
    setCropX(50);
    setCropY(50);
    setCropProcessing(false);
  };

  const openCropEditor = (file) => {
    if (!file) {
      return;
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (file.type && !allowedTypes.includes(file.type)) {
      setProfilePhotoError(
        "Only JPG, JPEG, PNG and WEBP images are allowed."
      );
      return;
    }

    if (cropImageUrl) {
      URL.revokeObjectURL(cropImageUrl);
    }

    setProfilePhotoError("");
    setProfilePhotoMessage("");
    setProfilePhotoFile(null);
    setCropImageFile(file);
    setCropImageDimensions({ width: 0, height: 0 });
    setCropImageUrl(URL.createObjectURL(file));
    setCropZoom(1);
    setCropX(50);
    setCropY(50);
  };

  const createCroppedProfilePhoto = async () => {
    if (!cropImageFile || !cropImageUrl || cropProcessing) {
      return;
    }

    try {
      setCropProcessing(true);
      setProfilePhotoError("");

      const image = new Image();

      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = cropImageUrl;
      });

      const imageWidth = image.naturalWidth;
      const imageHeight = image.naturalHeight;
      const baseCropSize = Math.min(imageWidth, imageHeight);
      const cropSize = baseCropSize / cropZoom;

      const maxLeft = Math.max(0, imageWidth - cropSize);
      const maxTop = Math.max(0, imageHeight - cropSize);

      const sourceX = maxLeft * (cropX / 100);
      const sourceY = maxTop * (cropY / 100);

      const outputSize = 600;
      const canvas = document.createElement("canvas");
      canvas.width = outputSize;
      canvas.height = outputSize;

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Unable to prepare the cropped image.");
      }

      context.drawImage(
        image,
        sourceX,
        sourceY,
        cropSize,
        cropSize,
        0,
        0,
        outputSize,
        outputSize
      );

      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.92);
      });

      if (!blob) {
        throw new Error("Unable to create the cropped image.");
      }

      const originalName =
        cropImageFile.name?.replace(/\.[^/.]+$/, "") || "profile";

      const croppedFile = new File(
        [blob],
        `${originalName}-cropped.jpg`,
        { type: "image/jpeg" }
      );

      setProfilePhotoFile(croppedFile);
      setProfilePhotoMessage(
        "Crop ready. Click Upload Photo to save it."
      );

      closeCropEditor();
    } catch (err) {
      console.error("Profile crop failed:", err);
      setProfilePhotoError(
        err.message || "Unable to crop this image."
      );
      setCropProcessing(false);
    }
  };

  const handleProfilePhotoUpload = async () => {
    if (!profilePhotoFile || profilePhotoUploading) {
      return;
    }

    const token = localStorage.getItem("access_token");

    if (!token) {
      setProfilePhotoError("Your login session is missing. Please login again.");
      return;
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (
      profilePhotoFile.type &&
      !allowedTypes.includes(profilePhotoFile.type)
    ) {
      setProfilePhotoError(
        "Only JPG, JPEG, PNG and WEBP images are allowed."
      );
      return;
    }

    const formData = new FormData();
    formData.append("profile_photo", profilePhotoFile);

    try {
      setProfilePhotoUploading(true);
      setProfilePhotoError("");
      setProfilePhotoMessage("");

      const response = await fetch("/api/users/profile/photo", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            data.error ||
            "Unable to upload profile photo."
        );
      }

      const updatedUser = data.user || {};

      setProfile((currentProfile) => ({
        ...(currentProfile || {}),
        ...updatedUser,
      }));

      onAuthUserUpdate?.(updatedUser);

      setProfilePhotoFile(null);
      setProfilePhotoMessage(
        data.message || "Profile photo uploaded successfully!"
      );
    } catch (err) {
      console.error("Profile photo upload failed:", err);
      setProfilePhotoError(
        err.message || "Unable to upload profile photo."
      );
    } finally {
      setProfilePhotoUploading(false);
    }
  };

  const handleProfilePhotoRemove = async () => {
    if (profilePhotoRemoving) {
      return;
    }

    const token = localStorage.getItem("access_token");

    if (!token) {
      setProfilePhotoError("Your login session is missing. Please login again.");
      return;
    }

    try {
      setProfilePhotoRemoving(true);
      setProfilePhotoError("");
      setProfilePhotoMessage("");

      const response = await fetch("/api/users/profile/photo", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to remove profile photo."
        );
      }

      const updatedUser = data.user || {};

      setProfile((currentProfile) => ({
        ...(currentProfile || {}),
        ...updatedUser,
        profile_photo_url: updatedUser.profile_photo_url ?? null,
      }));

      onAuthUserUpdate?.({
        ...updatedUser,
        profile_photo_url: updatedUser.profile_photo_url ?? null,
      });

      setProfilePhotoFile(null);
      setProfilePhotoMessage(
        data.message || "Profile photo removed successfully!"
      );
    } catch (err) {
      console.error("Profile photo removal failed:", err);
      setProfilePhotoError(
        err.message || "Unable to remove profile photo."
      );
    } finally {
      setProfilePhotoRemoving(false);
    }
  };

  if (!authUser) {
    return (
      <div
        style={{
          minHeight: "65vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "50px 20px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "520px" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>♙</div>
          <h2 style={{ color: "#ffffff", margin: 0 }}>Your Profile</h2>
          <p
            style={{
              color: "#888894",
              lineHeight: "1.6",
              margin: "12px 0 22px",
            }}
          >
            Login to view your ReelVerse profile.
          </p>
          <button
            type="button"
            onClick={onLoginNavigate}
            style={authPrimaryButtonStyle}
          >
            Login to continue
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="feed-message" style={{ margin: "60px 50px" }}>
        <div className="loading-spinner"></div>
        <p>Loading your profile...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="feed-message error-message" style={{ margin: "60px 50px" }}>
        <p>{error}</p>
      </div>
    );
  }

  const profileVideos = (profile?.videos || []).map((profileVideo) => {
    const fullVideo = videos.find((video) => video.id === profileVideo.id);
    return fullVideo ? { ...profileVideo, ...fullVideo } : profileVideo;
  });

  const displayUsername = profile?.username || authUser.username || "User";
  const profilePhotoUrl = profile?.profile_photo_url || null;

  return (
    <div className="rv-page" style={{ padding: "40px 50px 70px" }}>
      <span className="hero-label">✦ REELVERSE PROFILE</span>

      <div
        className="rv-pcard"
        style={{
          marginTop: "18px",
          padding: "28px",
          border: "1px solid #292932",
          borderRadius: "18px",
          background: "linear-gradient(135deg, #15121c, #101015)",
        }}
      >
        <div
          className={`rv-pcover ${coverUrl ? "rv-pcover-has-image" : ""}`}
          style={
            coverUrl ? { backgroundImage: `url("${coverUrl}")` } : undefined
          }
        >
          <input
            ref={coverInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "none" }}
            onChange={handleCoverFileChange}
          />

          <div className="rv-pcover-actions">
            <button
              type="button"
              disabled={coverBusy}
              onClick={() => coverInputRef.current && coverInputRef.current.click()}
            >
              {coverBusy
                ? "Working..."
                : coverUrl
                  ? "📷 Change cover"
                  : "📷 Add cover photo"}
            </button>

            {coverUrl && !coverBusy && (
              <button type="button" onClick={handleCoverRemove}>
                ✕ Remove
              </button>
            )}
          </div>

          {coverError && <p className="rv-pcover-error">{coverError}</p>}

          {coverCropFile && (
            <CoverCropModal
              file={coverCropFile}
              busy={coverBusy}
              onCancel={() => setCoverCropFile(null)}
              onConfirm={uploadCoverFile}
            />
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          <div
            className="rv-pavatar"
            style={{
              width: "76px",
              height: "76px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #7c3aed, #c04cff)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontSize: "30px",
              fontWeight: "800",
              boxShadow: "0 12px 35px rgba(124,58,237,0.25)",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            {profilePhotoUrl ? (
              <img
                src={profilePhotoUrl}
                alt={`${displayUsername} profile`}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            ) : (
              displayUsername.charAt(0).toUpperCase()
            )}
          </div>

          <div style={{ flex: 1, minWidth: "220px" }}>
            <h2
              style={{
                margin: 0,
                color: "#ffffff",
                fontSize: "30px",
              }}
            >
              {displayUsername}
            </h2>

            <p
              style={{
                margin: "7px 0 0",
                color: "#888894",
                fontSize: "14px",
              }}
            >
              {profile?.email || authUser.email}
            </p>

            {profile?.bio && (
              <p
                style={{
                  margin: "12px 0 0",
                  color: "#cfcfd7",
                  fontSize: "14px",
                  lineHeight: "1.6",
                  maxWidth: "620px",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {profile.bio}
              </p>
            )}

            {(profile?.website_url || profile?.youtube_url || profile?.instagram_url) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "9px", marginTop: "13px" }}>
                {profile.website_url && (
                  <a href={profile.website_url} target="_blank" rel="noopener noreferrer" className="rv-plink" style={profileLinkStyle}>🌐 Website</a>
                )}
                {profile.youtube_url && (
                  <a href={profile.youtube_url} target="_blank" rel="noopener noreferrer" className="rv-plink" style={profileLinkStyle}>▶ YouTube</a>
                )}
                {profile.instagram_url && (
                  <a href={profile.instagram_url} target="_blank" rel="noopener noreferrer" className="rv-plink" style={profileLinkStyle}>◎ Instagram</a>
                )}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleShareProfile}
              style={{
                ...authPrimaryButtonStyle,
                width: "auto",
                minWidth: "140px",
                background: "#18181f",
                border: "1px solid #3a3a45",
              }}
            >
              ↗ Share Profile
            </button>

            <button
              type="button"
              onClick={openEditProfile}
              style={{
                ...authPrimaryButtonStyle,
                width: "auto",
                minWidth: "140px",
              }}
            >
              ✎ Edit Profile
            </button>
          </div>
        </div>

        {profileShareMessage && (
          <div
            style={{
              marginTop: "16px",
              color: "#c4a7ff",
              fontSize: "13px",
            }}
          >
            {profileShareMessage}
          </div>
        )}

        <div
          className="rv-pstats"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: "12px",
            marginTop: "28px",
          }}
        >
          {[
            ["Videos", profile?.total_videos || 0],
            ["Followers", followersCount],
            ["Following", followingCount],
            ["Likes received", profile?.total_likes_received || 0],
          ].map(([label, value]) => {
            const isFollowersCard = label === "Followers";
            const isFollowingCard = label === "Following";
            const isPeopleCard = isFollowersCard || isFollowingCard;
            const isOpen =
              (isFollowersCard && showFollowersList) ||
              (isFollowingCard && showFollowingList);

            const togglePeopleList = () => {
              if (isFollowersCard) {
                setShowFollowersList((current) => !current);
                setShowFollowingList(false);
              }

              if (isFollowingCard) {
                setShowFollowingList((current) => !current);
                setShowFollowersList(false);
              }
            };

            return (
              <div
                className="rv-pstat"
                key={label}
                onClick={isPeopleCard ? togglePeopleList : undefined}
                role={isPeopleCard ? "button" : undefined}
                tabIndex={isPeopleCard ? 0 : undefined}
                onKeyDown={
                  isPeopleCard
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          togglePeopleList();
                        }
                      }
                    : undefined
                }
                style={{
                  padding: "16px",
                  border: isOpen
                    ? "1px solid #7c3aed"
                    : "1px solid #292932",
                  borderRadius: "12px",
                  background: isOpen
                    ? "rgba(124,58,237,0.12)"
                    : "#101016",
                  cursor: isPeopleCard ? "pointer" : "default",
                }}
                title={
                  isFollowersCard
                    ? "View followers"
                    : isFollowingCard
                      ? "View following"
                      : undefined
                }
              >
                <div
                  style={{
                    color: "#ffffff",
                    fontSize: "22px",
                    fontWeight: "800",
                  }}
                >
                  {value}
                </div>
                <div
                  style={{
                    color: "#777783",
                    fontSize: "12px",
                    marginTop: "4px",
                  }}
                >
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        {showFollowersList && (
          <div
            style={{
              marginTop: "16px",
              padding: "18px",
              border: "1px solid #343440",
              borderRadius: "14px",
              background: "#101016",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                marginBottom: followersList.length > 0 ? "14px" : 0,
              }}
            >
              <div
                style={{
                  color: "#ffffff",
                  fontSize: "16px",
                  fontWeight: "800",
                }}
              >
                Followers
              </div>

              <button
                type="button"
                onClick={() => setShowFollowersList(false)}
                style={{
                  width: "30px",
                  height: "30px",
                  borderRadius: "50%",
                  border: "1px solid #343440",
                  background: "#18181f",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: "17px",
                }}
                title="Close followers"
              >
                ×
              </button>
            </div>

            {followersList.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  color: "#777783",
                  fontSize: "13px",
                }}
              >
                No followers yet.
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "9px",
                }}
              >
                {followersList.map((follower) => (
                  <button
                    key={follower.id}
                    type="button"
                    onClick={() => navigate(`/users/${follower.id}`)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "10px 12px",
                      border: "1px solid #292932",
                      borderRadius: "12px",
                      background: "#15151b",
                      color: "#ffffff",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        width: "42px",
                        height: "42px",
                        borderRadius: "50%",
                        overflow: "hidden",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "linear-gradient(135deg, #7c3aed, #c04cff)",
                        color: "#ffffff",
                        fontSize: "16px",
                        fontWeight: "800",
                      }}
                    >
                      {follower.profile_photo_url ? (
                        <>
                          <img
                            src={follower.profile_photo_url}
                            alt={`${follower.username || "User"} profile`}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              display: "block",
                            }}
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                              const fallback =
                                event.currentTarget.nextElementSibling;
                              if (fallback) {
                                fallback.style.display = "flex";
                              }
                            }}
                          />
                          <span
                            style={{
                              width: "100%",
                              height: "100%",
                              display: "none",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {(follower.username || "U")
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                        </>
                      ) : (
                        (follower.username || "U").charAt(0).toUpperCase()
                      )}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          color: "#ffffff",
                          fontSize: "14px",
                          fontWeight: "750",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {follower.username || "Unknown user"}
                      </div>
                    </div>

                    <span
                      style={{
                        color: "#777783",
                        fontSize: "18px",
                        flexShrink: 0,
                      }}
                    >
                      ›
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {showFollowingList && (
          <div
            style={{
              marginTop: "16px",
              padding: "18px",
              border: "1px solid #343440",
              borderRadius: "14px",
              background: "#101016",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                marginBottom: followingList.length > 0 ? "14px" : 0,
              }}
            >
              <div
                style={{
                  color: "#ffffff",
                  fontSize: "16px",
                  fontWeight: "800",
                }}
              >
                Following
              </div>

              <button
                type="button"
                onClick={() => setShowFollowingList(false)}
                style={{
                  width: "30px",
                  height: "30px",
                  borderRadius: "50%",
                  border: "1px solid #343440",
                  background: "#18181f",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: "17px",
                }}
                title="Close following"
              >
                ×
              </button>
            </div>

            {followingList.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  color: "#777783",
                  fontSize: "13px",
                }}
              >
                Not following anyone yet.
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "9px",
                }}
              >
                {followingList.map((followedUser) => (
                  <button
                    key={followedUser.id}
                    type="button"
                    onClick={() => navigate(`/users/${followedUser.id}`)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "10px 12px",
                      border: "1px solid #292932",
                      borderRadius: "12px",
                      background: "#15151b",
                      color: "#ffffff",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        width: "42px",
                        height: "42px",
                        borderRadius: "50%",
                        overflow: "hidden",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "linear-gradient(135deg, #7c3aed, #c04cff)",
                        color: "#ffffff",
                        fontSize: "16px",
                        fontWeight: "800",
                      }}
                    >
                      {followedUser.profile_photo_url ? (
                        <>
                          <img
                            src={followedUser.profile_photo_url}
                            alt={`${followedUser.username || "User"} profile`}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              display: "block",
                            }}
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                              const fallback =
                                event.currentTarget.nextElementSibling;
                              if (fallback) {
                                fallback.style.display = "flex";
                              }
                            }}
                          />
                          <span
                            style={{
                              width: "100%",
                              height: "100%",
                              display: "none",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {(followedUser.username || "U")
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                        </>
                      ) : (
                        (followedUser.username || "U").charAt(0).toUpperCase()
                      )}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          color: "#ffffff",
                          fontSize: "14px",
                          fontWeight: "750",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {followedUser.username || "Unknown user"}
                      </div>
                    </div>

                    <span
                      style={{
                        color: "#777783",
                        fontSize: "18px",
                        flexShrink: 0,
                      }}
                    >
                      ›
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showEditProfile && (
        <div
          style={{
            marginTop: "22px",
            padding: "28px",
            border: "1px solid #343440",
            borderRadius: "18px",
            background: "linear-gradient(135deg, #15121c, #101015)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "18px",
              flexWrap: "wrap",
              marginBottom: "24px",
            }}
          >
            <div>
              <span className="hero-label">✦ PROFILE SETTINGS</span>
              <h3
                style={{
                  margin: "12px 0 6px",
                  color: "#ffffff",
                  fontSize: "26px",
                }}
              >
                Edit Profile
              </h3>
              <p
                style={{
                  margin: 0,
                  color: "#888894",
                  fontSize: "13px",
                  lineHeight: "1.6",
                }}
              >
                Update your profile details and choose how you appear on ReelVerse.
              </p>
            </div>

            <button
              type="button"
              onClick={closeEditProfile}
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "50%",
                border: "1px solid #343440",
                background: "#18181f",
                color: "#ffffff",
                fontSize: "20px",
                cursor: "pointer",
              }}
              title="Close profile settings"
            >
              ×
            </button>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "18px",
              flexWrap: "wrap",
              padding: "18px",
              marginBottom: "22px",
              border: "1px solid #292932",
              borderRadius: "14px",
              background: "#101016",
            }}
          >
            <div
              style={{
                width: "82px",
                height: "82px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #7c3aed, #c04cff)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                fontSize: "31px",
                fontWeight: "800",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              {profilePhotoUrl ? (
                <img
                  src={profilePhotoUrl}
                  alt={`${displayUsername} profile`}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                displayUsername.charAt(0).toUpperCase()
              )}
            </div>

            <div style={{ flex: 1, minWidth: "240px" }}>
              <div
                style={{
                  color: "#ffffff",
                  fontWeight: "750",
                  fontSize: "15px",
                }}
              >
                Profile photo
              </div>

              <p
                style={{
                  margin: "5px 0 12px",
                  color: "#777783",
                  fontSize: "12px",
                  lineHeight: "1.5",
                }}
              >
                {profilePhotoUrl
                  ? "Your current profile photo is shown here."
                  : "No profile photo yet. ReelVerse will use your initial."}
              </p>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <label
                  style={{
                    padding: "10px 14px",
                    borderRadius: "10px",
                    border: "1px solid #3a3a45",
                    background: "#18181f",
                    color: "#ffffff",
                    cursor: profilePhotoUploading ? "wait" : "pointer",
                    fontSize: "12px",
                    fontWeight: "700",
                  }}
                >
                  Choose Photo
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                    disabled={profilePhotoUploading || profilePhotoRemoving}
                    onChange={(event) => {
                      const selectedFile =
                        event.target.files?.[0] || null;

                      if (selectedFile) {
                        openCropEditor(selectedFile);
                      }

                      event.target.value = "";
                    }}
                    style={{ display: "none" }}
                  />
                </label>

                <button
                  type="button"
                  onClick={handleProfilePhotoUpload}
                  disabled={!profilePhotoFile || profilePhotoUploading || profilePhotoRemoving}
                  style={{
                    ...authPrimaryButtonStyle,
                    width: "auto",
                    minWidth: "120px",
                    padding: "10px 14px",
                    opacity:
                      !profilePhotoFile ||
                      profilePhotoUploading ||
                      profilePhotoRemoving
                        ? 0.5
                        : 1,
                    cursor:
                      !profilePhotoFile ||
                      profilePhotoUploading ||
                      profilePhotoRemoving
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  {profilePhotoUploading ? "Uploading..." : "Upload Photo"}
                </button>

                {profilePhotoUrl && (
                  <button
                    type="button"
                    onClick={handleProfilePhotoRemove}
                    disabled={profilePhotoUploading || profilePhotoRemoving}
                    style={{
                      padding: "10px 14px",
                      borderRadius: "10px",
                      border: "1px solid #5a2730",
                      background: "#211116",
                      color: "#ff8a9b",
                      cursor:
                        profilePhotoUploading || profilePhotoRemoving
                          ? "wait"
                          : "pointer",
                      fontSize: "12px",
                      fontWeight: "700",
                      opacity:
                        profilePhotoUploading || profilePhotoRemoving
                          ? 0.7
                          : 1,
                    }}
                  >
                    {profilePhotoRemoving ? "Removing..." : "Remove Photo"}
                  </button>
                )}
              </div>

              {profilePhotoFile && (
                <p
                  style={{
                    margin: "10px 0 0",
                    color: "#aaaab5",
                    fontSize: "11px",
                    overflowWrap: "anywhere",
                  }}
                >
                  Cropped photo ready: {profilePhotoFile.name}
                </p>
              )}

              {profilePhotoError && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "10px 12px",
                    borderRadius: "9px",
                    border: "1px solid #5a2730",
                    background: "#211116",
                    color: "#ff8a9b",
                    fontSize: "12px",
                    lineHeight: "1.5",
                  }}
                >
                  ⚠ {profilePhotoError}
                </div>
              )}

              {profilePhotoMessage && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "10px 12px",
                    borderRadius: "9px",
                    border: "1px solid #3c3150",
                    background: "#171220",
                    color: "#c4a7ff",
                    fontSize: "12px",
                    lineHeight: "1.5",
                  }}
                >
                  ✓ {profilePhotoMessage}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "16px",
            }}
          >
            <div>
              <label style={authLabelStyle}>Username</label>
              <input
                type="text"
                value={editUsername}
                onChange={(event) => setEditUsername(event.target.value)}
                style={authInputStyle}
              />
            </div>

            <div>
              <label style={authLabelStyle}>Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={(event) => setEditEmail(event.target.value)}
                style={authInputStyle}
              />

              {editEmail.trim() &&
                editEmail.trim().toLowerCase() !==
                  (profile?.email || authUser?.email || "")
                    .trim()
                    .toLowerCase() && (
                  <EmailVerifyBox
                    key={editEmail.trim().toLowerCase()}
                    newEmail={editEmail.trim().toLowerCase()}
                    verified={
                      verifiedNewEmail === editEmail.trim().toLowerCase()
                    }
                    onVerified={setVerifiedNewEmail}
                  />
                )}
            </div>
          </div>

          <div style={{ marginTop: "16px" }}>
            <label style={authLabelStyle}>Bio / Description</label>
            <textarea
              value={editBio}
              onChange={(event) => {
                if (event.target.value.length <= 500) {
                  setEditBio(event.target.value);
                }
              }}
              placeholder="Tell people about yourself, your content, channel or creative work..."
              rows={6}
              maxLength={500}
              style={{
                ...authInputStyle,
                resize: "vertical",
                minHeight: "135px",
              }}
            />

            <div
              style={{
                marginTop: "6px",
                textAlign: "right",
                color: "#777783",
                fontSize: "11px",
              }}
            >
              {editBio.length}/500
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "16px",
              marginTop: "16px",
            }}
          >
            <div>
              <label style={authLabelStyle}>Website</label>
              <input
                type="url"
                value={editWebsiteUrl}
                onChange={(event) => setEditWebsiteUrl(event.target.value)}
                placeholder="https://yourwebsite.com"
                style={authInputStyle}
              />
            </div>

            <div>
              <label style={authLabelStyle}>YouTube</label>
              <input
                type="url"
                value={editYoutubeUrl}
                onChange={(event) => setEditYoutubeUrl(event.target.value)}
                placeholder="https://youtube.com/@yourchannel"
                style={authInputStyle}
              />
            </div>

            <div>
              <label style={authLabelStyle}>Instagram</label>
              <input
                type="url"
                value={editInstagramUrl}
                onChange={(event) => setEditInstagramUrl(event.target.value)}
                placeholder="https://instagram.com/yourusername"
                style={authInputStyle}
              />
            </div>
          </div>

          {cropImageUrl && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                background: "rgba(5, 5, 10, 0.88)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "20px",
                backdropFilter: "blur(8px)",
              }}
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  closeCropEditor();
                }
              }}
            >
              <div
                style={{
                  width: "min(92vw, 520px)",
                  maxHeight: "92vh",
                  overflowY: "auto",
                  border: "1px solid #343440",
                  borderRadius: "18px",
                  background: "#111118",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
                  padding: "24px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "16px",
                    marginBottom: "18px",
                  }}
                >
                  <div>
                    <h3
                      style={{
                        margin: 0,
                        color: "#ffffff",
                        fontSize: "22px",
                      }}
                    >
                      Crop profile photo
                    </h3>
                    <p
                      style={{
                        margin: "6px 0 0",
                        color: "#888894",
                        fontSize: "12px",
                      }}
                    >
                      Zoom and reposition the photo before uploading.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={closeCropEditor}
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "50%",
                      border: "1px solid #343440",
                      background: "#18181f",
                      color: "#ffffff",
                      cursor: "pointer",
                      fontSize: "18px",
                    }}
                  >
                    ×
                  </button>
                </div>

                <div
                  style={{
                    width: "min(100%, 360px)",
                    aspectRatio: "1 / 1",
                    margin: "0 auto",
                    borderRadius: "16px",
                    overflow: "hidden",
                    position: "relative",
                    background: "#09090d",
                    border: "1px solid #343440",
                  }}
                >
                  <img
                    src={cropImageUrl}
                    alt="Crop preview"
                    draggable="false"
                    onLoad={(event) => {
                      setCropImageDimensions({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      });
                    }}
                    style={(() => {
                      const imageWidth = cropImageDimensions.width || 1;
                      const imageHeight = cropImageDimensions.height || 1;
                      const baseSize = Math.min(imageWidth, imageHeight);
                      const previewWidth =
                        (imageWidth / baseSize) * cropZoom * 100;
                      const previewHeight =
                        (imageHeight / baseSize) * cropZoom * 100;

                      return {
                        position: "absolute",
                        width: `${previewWidth}%`,
                        height: `${previewHeight}%`,
                        maxWidth: "none",
                        maxHeight: "none",
                        left: `${
                          -(previewWidth - 100) * (cropX / 100)
                        }%`,
                        top: `${
                          -(previewHeight - 100) * (cropY / 100)
                        }%`,
                        display: "block",
                        userSelect: "none",
                        pointerEvents: "none",
                      };
                    })()}
                  />

                  <div
                    style={{
                      position: "absolute",
                      inset: "8%",
                      borderRadius: "50%",
                      border: "2px solid rgba(255,255,255,0.9)",
                      boxShadow:
                        "0 0 0 999px rgba(0,0,0,0.38), inset 0 0 0 1px rgba(0,0,0,0.15)",
                      pointerEvents: "none",
                    }}
                  />
                </div>

                <div style={{ marginTop: "22px" }}>
                  <label style={authLabelStyle}>
                    Zoom — {cropZoom.toFixed(1)}×
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.1"
                    value={cropZoom}
                    onChange={(event) =>
                      setCropZoom(Number(event.target.value))
                    }
                    style={{ width: "100%" }}
                  />
                </div>

                <div style={{ marginTop: "16px" }}>
                  <label style={authLabelStyle}>Horizontal position</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={cropX}
                    onChange={(event) =>
                      setCropX(Number(event.target.value))
                    }
                    style={{ width: "100%" }}
                  />
                </div>

                <div style={{ marginTop: "16px" }}>
                  <label style={authLabelStyle}>Vertical position</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={cropY}
                    onChange={(event) =>
                      setCropY(Number(event.target.value))
                    }
                    style={{ width: "100%" }}
                  />
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "10px",
                    marginTop: "24px",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={closeCropEditor}
                    disabled={cropProcessing}
                    style={{
                      padding: "11px 18px",
                      borderRadius: "10px",
                      border: "1px solid #343440",
                      background: "#18181f",
                      color: "#d7d7df",
                      cursor: cropProcessing ? "wait" : "pointer",
                      fontWeight: "700",
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={createCroppedProfilePhoto}
                    disabled={cropProcessing}
                    style={{
                      ...authPrimaryButtonStyle,
                      width: "auto",
                      minWidth: "145px",
                      opacity: cropProcessing ? 0.7 : 1,
                      cursor: cropProcessing ? "wait" : "pointer",
                    }}
                  >
                    {cropProcessing ? "Preparing..." : "Use This Crop"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {profileSaveError && (
            <div
              style={{
                marginTop: "18px",
                padding: "12px 14px",
                borderRadius: "10px",
                border: "1px solid #5a2730",
                background: "#211116",
                color: "#ff8a9b",
                fontSize: "13px",
                lineHeight: "1.5",
              }}
            >
              ⚠ {profileSaveError}
            </div>
          )}

          {profileSaveMessage && (
            <div
              style={{
                marginTop: "18px",
                padding: "12px 14px",
                borderRadius: "10px",
                border: "1px solid #3c3150",
                background: "#171220",
                color: "#c4a7ff",
                fontSize: "13px",
                lineHeight: "1.5",
              }}
            >
              ✓ {profileSaveMessage}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
              flexWrap: "wrap",
              marginTop: "20px",
            }}
          >
            <button
              type="button"
              onClick={closeEditProfile}
              style={{
                padding: "11px 18px",
                borderRadius: "10px",
                border: "1px solid #343440",
                background: "#18181f",
                color: "#d7d7df",
                cursor: "pointer",
                fontWeight: "700",
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleProfileSave}
              disabled={profileSaving}
              style={{
                ...authPrimaryButtonStyle,
                width: "auto",
                minWidth: "140px",
                opacity: profileSaving ? 0.7 : 1,
                cursor: profileSaving ? "wait" : "pointer",
              }}
            >
              {profileSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: "38px" }}>
        <div className="feed-header">
          <div>
            <h3>Uploaded Videos</h3>
            <p>
              {profileVideos.length === 0
                ? "You haven't uploaded any videos yet."
                : `${profileVideos.length} video${profileVideos.length !== 1 ? "s" : ""} uploaded by ${displayUsername}.`}
            </p>
          </div>
        </div>

        {profileVideos.length === 0 ? (
          <div className="feed-message">
            <div style={{ fontSize: "38px", marginBottom: "10px" }}>▣</div>
            <p>No uploaded videos yet.</p>
          </div>
        ) : (
          <div className="video-grid">
            {profileVideos.map((video) => (
              <article className="video-card" key={video.id}>
                <div
                  className="thumbnail-container"
                  onClick={() => fullVideoForProfile(video, videos, openVideo)}
                  style={{ cursor: video.video_url ? "pointer" : "default" }}
                >
                  {video.thumbnail_url ? (
                    <img
                      src={video.thumbnail_url}
                      alt={video.title}
                      className="video-thumbnail"
                    />
                  ) : (
                    <div className="thumbnail-fallback">ReelVerse</div>
                  )}
                  {video.video_url && <button className="play-button">▶</button>}
                  <span className="category-badge">{video.category || "General"}</span>
                </div>

                <div className="video-info">
                  <h4>{video.title}</h4>
                  <p className="video-description">
                    {video.description || "No description available."}
                  </p>
                  <div className="video-stats">
                    <span>♥ {video.likes || 0}</span>
                    <span>◉ {video.views || 0}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function fullVideoForProfile(video, videos, openVideo) {
  const fullVideo = videos.find((item) => item.id === video.id);
  if (fullVideo?.video_url) {
    openVideo(fullVideo);
  }
}


// =====================================================
// OTHER USER PROFILE PAGE - DM STEP 3
// =====================================================

function OtherUserProfilePage({ authUser, videos, openVideo, onLoginNavigate }) {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [coverUrl, setCoverUrl] = useState("");
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageStatus, setMessageStatus] = useState("");
  const [messageError, setMessageError] = useState("");
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followError, setFollowError] = useState("");
  const [profileShareMessage, setProfileShareMessage] = useState("");

  const profileUserId = Number(userId);
  const isOwnProfile =
    Boolean(authUser?.id) && Number(authUser.id) === profileUserId;

  useEffect(() => {
    const loadUserProfile = async () => {
      if (!profileUserId) {
        setError("Invalid user profile.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");
        setMessageStatus("");
        setMessageError("");

        const [profileResponse, followersResponse, followingResponse] =
          await Promise.all([
            fetch(`/api/users/${profileUserId}`),
            fetch(`/api/users/${profileUserId}/followers`),
            fetch(`/api/users/${profileUserId}/following`),
          ]);

        const profileData = await profileResponse.json().catch(() => ({}));
        const followersData = await followersResponse.json().catch(() => ({}));
        const followingData = await followingResponse.json().catch(() => ({}));

        if (!profileResponse.ok) {
          throw new Error(
            profileData.message ||
              profileData.msg ||
              "Unable to load this profile."
          );
        }

        setProfile(profileData);
        setFollowersCount(followersData.total_followers || 0);
        setFollowingCount(followingData.total_following || 0);

        fetch(`/api/users/${profileUserId}/cover`)
          .then((coverResponse) => coverResponse.json())
          .then((coverData) =>
            setCoverUrl(coverData.cover_photo_url || "")
          )
          .catch(() => setCoverUrl(""));

        const followerList = Array.isArray(followersData.followers)
          ? followersData.followers
          : [];

        setIsFollowing(
          Boolean(authUser?.id) &&
            followerList.some(
              (follower) => Number(follower.id) === Number(authUser.id)
            )
        );
      } catch (err) {
        console.error("Other user profile request failed:", err);
        setProfile(null);
        setError(err.message || "Unable to load this profile.");
      } finally {
        setLoading(false);
      }
    };

    loadUserProfile();
  }, [profileUserId, authUser?.id]);

  const handleShareProfile = async () => {
    if (!profile?.id) {
      return;
    }

    const name = profile.username || "this creator";

    setProfileShareMessage("");

    const message = await shareLink({
      title: `${name} on ReelVerse`,
      text: `Check out ${name}'s profile on ReelVerse.`,
      url: `${window.location.origin}/users/${profile.id}`,
      copiedMessage: "Profile link copied!",
    });

    if (message) {
      setProfileShareMessage(message);
    }
  };

  const handleFollowToggle = async () => {
    if (!authUser) {
      onLoginNavigate();
      return;
    }

    if (!profile?.id || isOwnProfile || followLoading) {
      return;
    }

    const token = localStorage.getItem("access_token");

    if (!token) {
      onLoginNavigate();
      return;
    }

    const wasFollowing = isFollowing;

    try {
      setFollowLoading(true);
      setFollowError("");

      const response = await fetch(
        `/api/users/${profile.id}/follow`,
        {
          method: wasFollowing ? "DELETE" : "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            (wasFollowing
              ? "Unable to unfollow this user."
              : "Unable to follow this user.")
        );
      }

      setIsFollowing(!wasFollowing);
      setFollowersCount((currentCount) =>
        wasFollowing
          ? Math.max(0, currentCount - 1)
          : currentCount + 1
      );
    } catch (err) {
      console.error("Follow request failed:", err);
      setFollowError(
        err.message || "Unable to update follow status."
      );
    } finally {
      setFollowLoading(false);
    }
  };

  const handleMessage = async () => {
    if (!authUser) {
      onLoginNavigate();
      return;
    }

    if (!profile?.id || isOwnProfile) {
      return;
    }

    const token = localStorage.getItem("access_token");

    if (!token) {
      onLoginNavigate();
      return;
    }

    try {
      setMessageLoading(true);
      setMessageStatus("");
      setMessageError("");

      const response = await fetch(
        `/api/messages/users/${profile.id}/conversation`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to open this conversation."
        );
      }

      const conversationId =
        data.conversation?.id;

      if (!conversationId) {
        throw new Error(
          "Conversation was created, but its ID was not returned."
        );
      }

      navigate(`/messages/${conversationId}`);
    } catch (err) {
      console.error("Start conversation failed:", err);
      setMessageError(
        err.message || "Unable to start this conversation."
      );
    } finally {
      setMessageLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="feed-message" style={{ margin: "60px 50px" }}>
        <div className="loading-spinner"></div>
        <p>Loading profile...</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div
        className="feed-message error-message"
        style={{ margin: "60px 50px" }}
      >
        <p>{error || "User not found."}</p>
      </div>
    );
  }

  const profileVideos = (profile.videos || []).map((profileVideo) => {
    const fullVideo = videos.find((video) => video.id === profileVideo.id);
    return fullVideo ? { ...profileVideo, ...fullVideo } : profileVideo;
  });

  return (
    <div className="rv-page" style={{ padding: "40px 50px 70px" }}>
      <span className="hero-label">✦ CREATOR PROFILE</span>

      <div
        className="rv-pcard"
        style={{
          marginTop: "18px",
          padding: "28px",
          border: "1px solid #292932",
          borderRadius: "18px",
          background: "linear-gradient(135deg, #15121c, #101015)",
        }}
      >
        <div
          className={`rv-pcover ${coverUrl ? "rv-pcover-has-image" : ""}`}
          style={
            coverUrl ? { backgroundImage: `url("${coverUrl}")` } : undefined
          }
        ></div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          <div
            className="rv-pavatar"
            style={{
              width: "76px",
              height: "76px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #7c3aed, #c04cff)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontSize: "30px",
              fontWeight: "800",
              boxShadow: "0 12px 35px rgba(124,58,237,0.25)",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            {profile.profile_photo_url ? (
              <>
                <img
                  src={profile.profile_photo_url}
                  alt={`${profile.username || "User"} profile`}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                    const fallback =
                      event.currentTarget.nextElementSibling;
                    if (fallback) {
                      fallback.style.display = "flex";
                    }
                  }}
                />
                <span
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "none",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {(profile.username || "U").charAt(0).toUpperCase()}
                </span>
              </>
            ) : (
              (profile.username || "U").charAt(0).toUpperCase()
            )}
          </div>

          <div style={{ flex: 1, minWidth: "180px" }}>
            <h2
              style={{
                margin: 0,
                color: "#ffffff",
                fontSize: "30px",
              }}
            >
              {profile.username}
            </h2>

            <p
              style={{
                margin: "7px 0 0",
                color: "#888894",
                fontSize: "14px",
              }}
            >
              {profile.email}
            </p>

            {profile.bio && (
              <p style={{ margin: "12px 0 0", color: "#cfcfd7", fontSize: "14px", lineHeight: "1.6", maxWidth: "620px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {profile.bio}
              </p>
            )}

            {(profile.website_url || profile.youtube_url || profile.instagram_url) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "9px", marginTop: "13px" }}>
                {profile.website_url && (
                  <a href={profile.website_url} target="_blank" rel="noopener noreferrer" className="rv-plink" style={profileLinkStyle}>🌐 Website</a>
                )}
                {profile.youtube_url && (
                  <a href={profile.youtube_url} target="_blank" rel="noopener noreferrer" className="rv-plink" style={profileLinkStyle}>▶ YouTube</a>
                )}
                {profile.instagram_url && (
                  <a href={profile.instagram_url} target="_blank" rel="noopener noreferrer" className="rv-plink" style={profileLinkStyle}>◎ Instagram</a>
                )}
              </div>
            )}
          </div>

          {isOwnProfile ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleShareProfile}
                style={{
                  ...authPrimaryButtonStyle,
                  width: "auto",
                  minWidth: "140px",
                  background: "#18181f",
                  border: "1px solid #3a3a45",
                }}
              >
                ↗ Share Profile
              </button>

              <button
                type="button"
                onClick={() => navigate("/profile")}
                style={{
                  ...authPrimaryButtonStyle,
                  width: "auto",
                  minWidth: "130px",
                }}
              >
                My Profile
              </button>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={handleShareProfile}
                style={{
                  ...authPrimaryButtonStyle,
                  width: "auto",
                  minWidth: "140px",
                  background: "#18181f",
                  border: "1px solid #3a3a45",
                }}
              >
                ↗ Share Profile
              </button>

              <button
                type="button"
                onClick={handleFollowToggle}
                disabled={followLoading}
                style={{
                  ...authPrimaryButtonStyle,
                  width: "auto",
                  minWidth: "130px",
                  background: isFollowing
                    ? "#18181f"
                    : authPrimaryButtonStyle.background,
                  border: isFollowing
                    ? "1px solid #3a3a45"
                    : authPrimaryButtonStyle.border,
                  opacity: followLoading ? 0.7 : 1,
                  cursor: followLoading ? "wait" : "pointer",
                }}
              >
                {followLoading
                  ? "Updating..."
                  : !authUser
                    ? "Follow"
                    : isFollowing
                      ? "✓ Following"
                      : "+ Follow"}
              </button>

              <button
                type="button"
                onClick={handleMessage}
                disabled={messageLoading}
                style={{
                  ...authPrimaryButtonStyle,
                  width: "auto",
                  minWidth: "145px",
                  opacity: messageLoading ? 0.7 : 1,
                  cursor: messageLoading ? "wait" : "pointer",
                }}
              >
                {messageLoading
                  ? "Opening..."
                  : authUser
                    ? "✉ Message"
                    : "Login to Message"}
              </button>
            </div>
          )}
        </div>

        {profileShareMessage && (
          <div
            style={{
              marginTop: "18px",
              padding: "12px 14px",
              borderRadius: "10px",
              border: "1px solid #3c3150",
              background: "#171220",
              color: "#c4a7ff",
              fontSize: "13px",
              lineHeight: "1.5",
            }}
          >
            {profileShareMessage}
          </div>
        )}

        {followError && (
          <div
            style={{
              marginTop: "18px",
              padding: "12px 14px",
              borderRadius: "10px",
              border: "1px solid #5a2730",
              background: "#211116",
              color: "#ff8a9b",
              fontSize: "13px",
              lineHeight: "1.5",
            }}
          >
            {followError}
          </div>
        )}

        {messageStatus && (
          <div
            style={{
              marginTop: "18px",
              padding: "12px 14px",
              borderRadius: "10px",
              border: "1px solid #3c3150",
              background: "#171220",
              color: "#c4a7ff",
              fontSize: "13px",
              lineHeight: "1.5",
            }}
          >
            {messageStatus}
          </div>
        )}

        {messageError && (
          <div
            style={{
              marginTop: "18px",
              padding: "12px 14px",
              borderRadius: "10px",
              border: "1px solid #5a2730",
              background: "#211116",
              color: "#ff8a9b",
              fontSize: "13px",
              lineHeight: "1.5",
            }}
          >
            {messageError}
          </div>
        )}

        <div
          className="rv-pstats"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: "12px",
            marginTop: "28px",
          }}
        >
          {[
            ["Videos", profile.total_videos || 0],
            ["Followers", followersCount],
            ["Following", followingCount],
            ["Likes received", profile.total_likes_received || 0],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                padding: "16px",
                border: "1px solid #292932",
                borderRadius: "12px",
                background: "#101016",
              }}
            >
              <div
                style={{
                  color: "#ffffff",
                  fontSize: "22px",
                  fontWeight: "800",
                }}
              >
                {value}
              </div>
              <div
                style={{
                  color: "#777783",
                  fontSize: "12px",
                  marginTop: "4px",
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: "38px" }}>
        <div className="feed-header">
          <div>
            <h3>{profile.username}'s Videos</h3>
            <p>
              {profileVideos.length === 0
                ? "No uploaded videos yet."
                : `${profileVideos.length} video${
                    profileVideos.length !== 1 ? "s" : ""
                  } uploaded by ${profile.username}.`}
            </p>
          </div>
        </div>

        {profileVideos.length === 0 ? (
          <div className="feed-message">
            <div style={{ fontSize: "38px", marginBottom: "10px" }}>▣</div>
            <p>No uploaded videos yet.</p>
          </div>
        ) : (
          <div className="video-grid">
            {profileVideos.map((video) => (
              <article className="video-card" key={video.id}>
                <div
                  className="thumbnail-container"
                  onClick={() => fullVideoForProfile(video, videos, openVideo)}
                  style={{ cursor: video.video_url ? "pointer" : "default" }}
                >
                  {video.thumbnail_url ? (
                    <img
                      src={video.thumbnail_url}
                      alt={video.title}
                      className="video-thumbnail"
                    />
                  ) : (
                    <div className="thumbnail-fallback">ReelVerse</div>
                  )}

                  {video.video_url && (
                    <button className="play-button">▶</button>
                  )}

                  <span className="category-badge">
                    {video.category || "General"}
                  </span>
                </div>

                <div className="video-info">
                  <h4>{video.title}</h4>
                  <p className="video-description">
                    {video.description || "No description available."}
                  </p>
                  <div className="video-stats">
                    <span>♥ {video.likes || 0}</span>
                    <span>◉ {video.views || 0}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// =====================================================
// SIGN-IN BACKDROP - scrolling wall of film posters
// =====================================================

const AUTH_POSTERS = [
  ["NIGHT SHIFT", "#b4232f", "#240a12"],
  ["PAPER BOATS", "#1f6f8b", "#0a2330"],
  ["LAST SIGNAL", "#35418a", "#0e1033"],
  ["GOLDEN HOUR", "#d98a1c", "#3a1a08"],
  ["SALT AND IRON", "#3f4a52", "#12171b"],
  ["THE LONG WAY", "#2f7d5b", "#0b2218"],
  ["NEON TIDE", "#c2185b", "#1b0715"],
  ["QUIET HOURS", "#5a4a8c", "#15112b"],
  ["FIRST SNOW", "#5d8fb5", "#112033"],
  ["RUNAWAY", "#a8412a", "#2a0f09"],
  ["HARBOR LIGHTS", "#c9922e", "#1f1408"],
  ["DEEP FOCUS", "#2a6f6a", "#08201f"],
  ["STATIC", "#6b6b78", "#16161c"],
  ["MIDNIGHT DINER", "#b3263f", "#1a0a10"],
  ["COLD OPEN", "#2e5aa8", "#0a1630"],
  ["SUMMER CUT", "#e0742c", "#33150a"],
];

// Lines shown on the left side of the sign-in pages. Edit freely:
// each item is [first line, second line].
const AUTH_QUOTES = [
  ["Every great story", "starts with one upload."],
  ["Your next favorite film", "is one scroll away."],
  ["Short on time,", "never short on stories."],
  ["Make it. Share it.", "Let the world press play."],
  ["Behind every view", "is someone who felt something."],
  ["The best seat in the house", "is wherever you press play."],
];

function AuthQuotes() {
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) {
      return undefined;
    }

    // Respect "reduce motion": keep the first line still.
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return undefined;
    }

    const leaveTimer = window.setTimeout(() => setLeaving(true), 5200);

    const swapTimer = window.setTimeout(() => {
      setQuoteIndex((current) => (current + 1) % AUTH_QUOTES.length);
      setLeaving(false);
    }, 5700);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(swapTimer);
    };
  }, [quoteIndex, paused]);

  const quote = AUTH_QUOTES[quoteIndex];

  return (
    <div
      className="auth-quotes"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <p
        key={quoteIndex}
        className={`auth-quote ${leaving ? "auth-quote-out" : ""}`}
      >
        <span className="auth-quote-l1">{quote[0]}</span>
        <span className="auth-quote-l2">{quote[1]}</span>
      </p>

      <p className="auth-quotes-sub">
        Watch, upload and follow creators, all in one place.
      </p>

      <div className="auth-dots">
        {AUTH_QUOTES.map((_, dotIndex) => (
          <button
            key={dotIndex}
            type="button"
            aria-label={`Show line ${dotIndex + 1}`}
            className={`auth-dot ${
              dotIndex === quoteIndex ? "auth-dot-active" : ""
            }`}
            onClick={() => {
              setQuoteIndex(dotIndex);
              setLeaving(false);
            }}
          ></button>
        ))}
      </div>
    </div>
  );
}

// =====================================================
// ReelVerse LOGO - a film reel with an orbiting dot and a play button
// =====================================================
function ReelVerseMark({ size }) {
  return (
    <svg
      className="rv-mark"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="ReelVerse logo"
    >
      <defs>
        <linearGradient
          id="rv-mark-grad"
          x1="8"
          y1="56"
          x2="56"
          y2="8"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#6d28d9" />
          <stop offset="0.55" stopColor="#a855f7" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <circle
        cx="32"
        cy="32"
        r="22"
        fill="none"
        stroke="url(#rv-mark-grad)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray="112 26.2"
        transform="rotate(-20 32 32)"
      />
      <circle cx="48.5" cy="15.5" r="4.6" fill="#f0abfc" />
      <path
        d="M27 23.5 43 32 27 40.5z"
        fill="#fff"
        stroke="#fff"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// =====================================================
// LOGIN FOOTER - About, Contact us and version
// Edit APP_VERSION and CONTACT_INFO below. Empty values are hidden.
// =====================================================
const APP_VERSION = "v1.0.0";

const CONTACT_INFO = {
  email: "shafeekh67@gmail.com",
  location: "Kochi, India",
  links: [
    { label: "Instagram", url: "" },
    { label: "LinkedIn", url: "https://www.linkedin.com/in/shafeek-h67" },
    { label: "GitHub", url: "https://github.com/shafeekH-Developer" },
    { label: "YouTube", url: "" },
  ],
};

const AUTH_INFO_CSS = `
.rv-af { position: fixed; left: 0; right: 0; bottom: 14px; z-index: 5; display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; font-family: Inter, system-ui, sans-serif; }
.rv-af-links { display: flex; align-items: center; gap: 10px; pointer-events: auto; }
.rv-af-btn { background: none; border: 0; padding: 4px 6px; color: #c4b5fd; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
.rv-af-btn:hover { color: #fff; text-decoration: underline; }
.rv-af-dot { color: #5b5470; }
.rv-af-ver { font-size: 11px; letter-spacing: 1.4px; color: #8a849c; text-transform: uppercase; }
.rv-ai-back { position: fixed; inset: 0; z-index: 3000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(5,3,12,0.72); backdrop-filter: blur(8px); font-family: Inter, system-ui, sans-serif; }
.rv-ai-modal { position: relative; width: 100%; max-width: 480px; max-height: 88vh; overflow: auto; padding: 28px; border-radius: 20px; background: linear-gradient(160deg, #1a1030, #0c0a14 70%); border: 1px solid rgba(139,92,246,0.35); box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 60px rgba(124,58,237,0.2); color: #e8e4f4; }
.rv-ai-modal h2 { margin: 0 0 6px; font-size: 26px; letter-spacing: 1.5px; color: #fff; font-family: "Bebas Neue", Inter, sans-serif; font-weight: 400; }
.rv-ai-modal p { margin: 0 0 12px; font-size: 14px; line-height: 1.6; color: #b9b3cc; }
.rv-ai-x { position: absolute; top: 14px; right: 14px; width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); color: #fff; font-size: 16px; cursor: pointer; }
.rv-ai-x:hover { background: rgba(255,255,255,0.14); }
.rv-ai-feat { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 14px 0; }
.rv-ai-feat span { padding: 9px 11px; border-radius: 10px; background: rgba(139,92,246,0.12); border: 1px solid rgba(139,92,246,0.22); font-size: 13px; color: #ddd6fe; }
.rv-ai-row { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; margin-bottom: 8px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); text-decoration: none; }
.rv-ai-row small { font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; color: #8a849c; }
.rv-ai-row b { font-size: 15px; font-weight: 600; color: #fff; word-break: break-all; }
a.rv-ai-row:hover { border-color: rgba(167,139,250,0.6); background: rgba(139,92,246,0.14); }
.rv-ai-ver { margin-top: 14px; font-size: 11px; letter-spacing: 1.4px; text-transform: uppercase; color: #8a849c; }
`;

function AuthFooterInfo() {
  const [panel, setPanel] = useState(null);

  useEffect(() => {
    if (!panel) {
      return undefined;
    }
    const onKey = (event) => {
      if (event.key === "Escape") {
        setPanel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  // Add https:// when a link was typed without it, so it opens the real site.
  const withProtocol = (url) => (/^(https?:|mailto:)/i.test(url) ? url : `https://${url}`);
  const links = CONTACT_INFO.links
    .filter((item) => item.url)
    .map((item) => ({ ...item, url: withProtocol(item.url.trim()) }));
  const emailHref = /@gmail\.com$/i.test(CONTACT_INFO.email)
    ? `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(CONTACT_INFO.email)}`
    : `mailto:${CONTACT_INFO.email}`;
  const hasContact = CONTACT_INFO.email || CONTACT_INFO.location || links.length > 0;

  return (
    <>
      <style>{AUTH_INFO_CSS}</style>

      <div className="rv-af">
        <div className="rv-af-links">
          <button type="button" className="rv-af-btn" onClick={() => setPanel("about")}>
            About
          </button>
          <span className="rv-af-dot">•</span>
          <button type="button" className="rv-af-btn" onClick={() => setPanel("contact")}>
            Contact us
          </button>
        </div>
        <div className="rv-af-ver">ReelVerse {APP_VERSION}</div>
      </div>

      {panel &&
        createPortal(
          <div
            className="rv-ai-back"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setPanel(null);
              }
            }}
          >
            <div className="rv-ai-modal" role="dialog" aria-label={panel === "about" ? "About ReelVerse" : "Contact us"}>
              <button type="button" className="rv-ai-x" aria-label="Close" onClick={() => setPanel(null)}>
                ✕
              </button>

              {panel === "about" ? (
                <>
                  <h2>About ReelVerse</h2>
                  <p>
                    ReelVerse is a video-sharing platform where creators upload
                    their work and viewers discover, follow and talk about it, all
                    in one place.
                  </p>
                  <div className="rv-ai-feat">
                    <span>▶ Watch and share videos</span>
                    <span>⬆ Upload your own</span>
                    <span>♥ Follow creators</span>
                    <span>✉ Message and comment</span>
                  </div>
                  <p>Built with care in Kochi, India.</p>
                  <div className="rv-ai-ver">Version {APP_VERSION}</div>
                </>
              ) : (
                <>
                  <h2>Contact us</h2>
                  <p>Questions, feedback or ideas? We would love to hear from you.</p>

                  {CONTACT_INFO.email && (
                    <a className="rv-ai-row" href={emailHref} target="_blank" rel="noreferrer">
                      <small>Email</small>
                      <b>{CONTACT_INFO.email} ↗</b>
                    </a>
                  )}

                  {CONTACT_INFO.location && (
                    <div className="rv-ai-row">
                      <small>Location</small>
                      <b>{CONTACT_INFO.location}</b>
                    </div>
                  )}

                  {links.map((item) => (
                    <a
                      key={item.label}
                      className="rv-ai-row"
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <small>{item.label}</small>
                      <b>{item.url.replace(/^https?:\/\/(www\.)?/, "")} ↗</b>
                    </a>
                  ))}

                  {!hasContact && <p>Contact details are coming soon.</p>}
                  <div className="rv-ai-ver">Version {APP_VERSION}</div>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function AuthBackdrop() {
  const navigate = useNavigate();

  const rows = [0, 1, 2, 3].map((rowIndex) =>
    Array.from(
      { length: 8 },
      (_, i) => AUTH_POSTERS[(rowIndex * 4 + i) % AUTH_POSTERS.length]
    )
  );

  return (
    <>
      <div className="auth-backdrop" aria-hidden="true">
        <div className="auth-wall">
          {rows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              className={`auth-row ${
                rowIndex % 2 ? "auth-row-reverse" : ""
              }`}
            >
              <div
                className="auth-track"
                style={{ animationDuration: `${90 + rowIndex * 14}s` }}
              >
                {[...row, ...row].map((poster, i) => (
                  <div
                    key={i}
                    className={`auth-poster auth-poster-v${
                      (i + rowIndex) % 4
                    }`}
                    style={{
                      background: `linear-gradient(165deg, ${poster[1]}, ${poster[2]})`,
                    }}
                  >
                    <span>{poster[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="auth-vignette"></div>
        <div className="auth-grain"></div>
      </div>

      <button
        type="button"
        className="auth-brand"
        onClick={() => navigate("/")}
        aria-label="ReelVerse home"
      >
        <span className="logo-mark">
          <ReelVerseMark />
        </span>
        <span className="auth-brand-name">
          Reel<span className="rv-wm-v">Verse</span>
        </span>
      </button>

      <AuthQuotes />
      <AuthFooterInfo />
    </>
  );
}


// =====================================================
// HOME - featured billboard and horizontal rows
// =====================================================

// Kept for later use (the home page now shows HomeHero instead).
// eslint-disable-next-line no-unused-vars
function HomeBillboard({ video, openVideo, openComments }) {
  if (!video) {
    return null;
  }

  return (
    <section className="rv-billboard">
      <div
        className="rv-billboard-bg"
        style={{
          backgroundImage: video.thumbnail_url
            ? `url("${video.thumbnail_url}")`
            : undefined,
        }}
      ></div>

      <div className="rv-billboard-content">
        <p className="rv-billboard-meta">
          {video.category && (
            <span className="rv-chip">{video.category}</span>
          )}
          <span>by {video.creator || "Unknown"}</span>
        </p>

        <h2>{video.title}</h2>

        {video.description && (
          <p className="rv-billboard-desc">{video.description}</p>
        )}

        <div className="rv-billboard-actions">
          <button
            type="button"
            className="rv-btn rv-btn-play"
            onClick={() => openVideo(video)}
          >
            ▶ Play
          </button>

          <button
            type="button"
            className="rv-btn rv-btn-ghost"
            onClick={() => openComments(video)}
          >
            💬 Comments
          </button>
        </div>
      </div>
    </section>
  );
}

// =====================================================
// HOME - animated welcome hero (no video, quotes + motion)
// =====================================================

// Lines that rotate in the home hero. Edit freely:
// each item is [first line, second line].
const HOME_QUOTES = [
  ["Every great story", "starts with one upload."],
  ["Lights. Camera.", "Your turn, creator."],
  ["Short on time,", "never short on stories."],
  ["Make it. Share it.", "Let the world press play."],
  ["Behind every view", "is someone who felt something."],
  ["The best seat in the house", "is wherever you press play."],
];

function HomeHero() {
  const navigate = useNavigate();
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);

  let displayName = "";

  try {
    const stored = JSON.parse(localStorage.getItem("user") || "null");
    displayName = (stored && (stored.username || stored.name)) || "";
  } catch (error) {
    displayName = "";
  }

  useEffect(() => {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return undefined;
    }

    const leaveTimer = window.setTimeout(() => setLeaving(true), 4600);

    const swapTimer = window.setTimeout(() => {
      setQuoteIndex((current) => (current + 1) % HOME_QUOTES.length);
      setLeaving(false);
    }, 5100);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(swapTimer);
    };
  }, [quoteIndex]);

  const quote = HOME_QUOTES[quoteIndex];

  return (
    <section className="rv-hero">
      <div className="rv-hero-aurora rv-hero-aurora-a"></div>
      <div className="rv-hero-aurora rv-hero-aurora-b"></div>
      <div className="rv-hero-aurora rv-hero-aurora-c"></div>
      <div className="rv-hero-film rv-hero-film-a"></div>
      <div className="rv-hero-film rv-hero-film-b"></div>

      <div className="rv-hero-sparks" aria-hidden="true">
        {Array.from({ length: 14 }).map((_, index) => (
          <span key={index} style={{ "--i": index }}></span>
        ))}
      </div>

      <div className="rv-hero-content">
        <p className="rv-hero-eyebrow">
          <span className="rv-hero-live"></span>
          {displayName
            ? `WELCOME BACK, ${displayName.toUpperCase()}`
            : "WELCOME TO REELVERSE"}
        </p>

        <h2
          key={quoteIndex}
          className={`rv-hero-quote ${leaving ? "rv-hero-quote-out" : ""}`}
        >
          <span className="rv-hero-l1">{quote[0]}</span>
          <span className="rv-hero-l2">{quote[1]}</span>
        </h2>

        <p className="rv-hero-sub">
          Watch short films, follow creators you love and share your
          own stories with the world.
        </p>

        <div className="rv-hero-actions">
          <button
            type="button"
            className="rv-btn rv-btn-play"
            onClick={() => navigate("/explore")}
          >
            ▶ Start watching
          </button>

        </div>

        <div className="rv-hero-dots">
          {HOME_QUOTES.map((_, dotIndex) => (
            <button
              key={dotIndex}
              type="button"
              aria-label={`Show line ${dotIndex + 1}`}
              className={`rv-hero-dot ${
                dotIndex === quoteIndex ? "rv-hero-dot-active" : ""
              }`}
              onClick={() => {
                setQuoteIndex(dotIndex);
                setLeaving(false);
              }}
            ></button>
          ))}
        </div>
      </div>

      <div className="rv-hero-art" aria-hidden="true">
        <div className="rv-orb">
          <span className="rv-orb-ring rv-orb-ring-1"></span>
          <span className="rv-orb-ring rv-orb-ring-2"></span>
          <span className="rv-orb-ring rv-orb-ring-3"></span>
          <span className="rv-orb-dot rv-orb-dot-1"></span>
          <span className="rv-orb-dot rv-orb-dot-2"></span>
          <span className="rv-orb-play">▶</span>
        </div>
      </div>
    </section>
  );
}

function VideoRow({ title, subtitle, videos, ...gridProps }) {
  const trackRef = useRef(null);

  if (!videos || videos.length === 0) {
    return null;
  }

  const scrollRow = (direction) => {
    const track = trackRef.current;

    if (!track || !track.scrollBy) {
      return;
    }

    track.scrollBy({
      left: direction * Math.max(240, track.clientWidth * 0.85),
      behavior: "smooth",
    });
  };

  return (
    <section className="rv-row">
      <div className="rv-row-head">
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>

      <div className="rv-row-body">
        <button
          type="button"
          className="rv-row-arrow rv-row-arrow-left"
          aria-label={`Scroll ${title} left`}
          onClick={() => scrollRow(-1)}
        >
          ‹
        </button>

        <div className="rv-row-track" ref={trackRef}>
          <VideoGrid videos={videos} {...gridProps} />
        </div>

        <button
          type="button"
          className="rv-row-arrow rv-row-arrow-right"
          aria-label={`Scroll ${title} right`}
          onClick={() => scrollRow(1)}
        >
          ›
        </button>
      </div>
    </section>
  );
}


// =====================================================
// HOME PAGE
// =====================================================

function HomePage({
  videos,
  loading,
  error,
  openVideo,
  openComments,
  commentsCount,
  likedVideos,
  onToggleLike,
  likeLoading,
  bookmarkedVideos,
  onToggleBookmark,
  bookmarkLoading,
}) {
  const navigate = useNavigate();

  const hasVideos = !loading && !error && videos.length > 0;
  const videoScore = (item) =>
    (Number(item.views) || 0) + (Number(item.likes) || 0) * 3;

  const popularVideos = hasVideos
    ? [...videos].sort((a, b) => videoScore(b) - videoScore(a))
    : [];
  const latestVideos = hasVideos
    ? [...videos].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      )
    : [];

  const categoryRows = hasVideos
    ? Object.entries(
        videos.reduce((groups, item) => {
          const name = item.category || "Other";
          (groups[name] = groups[name] || []).push(item);
          return groups;
        }, {})
      )
        .filter(([, list]) => list.length >= 2)
        .slice(0, 3)
    : [];

  const rowProps = {
    openVideo,
    openComments,
    commentsCount,
    likedVideos,
    onToggleLike,
    likeLoading,
    bookmarkedVideos,
    onToggleBookmark,
    bookmarkLoading,
  };

  return (
    <>
      <HomeHero />

      <section
        className="hero"
        style={{ display: "none" }}
      >
        <div className="hero-text">
          <span className="hero-label">
            ✦ DISCOVER NEW STORIES
          </span>

          <h2>
            Watch something
            <br />
            <span>worth sharing.</span>
          </h2>

          <p>
            Discover short films, reels and creative stories from
            the next generation of filmmakers.
          </p>
        </div>
      </section>

      <div className="category-bar">
        <button
          className="category active-category"
          onClick={() => navigate("/")}
        >
          For You
        </button>

        <button
          className="category"
          onClick={() => navigate("/trending")}
        >
          Trending
        </button>

        <button
          className="category"
          onClick={() => navigate("/explore")}
        >
          Education
        </button>

        <button
          className="category"
          onClick={() => navigate("/explore")}
        >
          Entertainment
        </button>

        <button
          className="category"
          onClick={() => navigate("/explore")}
        >
          Short Films
        </button>

        <button
          className="category"
          onClick={() => navigate("/explore")}
        >
          Comedy
        </button>
      </div>

      {hasVideos && videos.length >= 4 && (
        <>
          <VideoRow
            title="Popular right now"
            subtitle="Most watched and loved"
            videos={popularVideos.slice(0, 12)}
            {...rowProps}
          />

          <VideoRow
            title="New on ReelVerse"
            subtitle="Fresh uploads"
            videos={latestVideos.slice(0, 12)}
            {...rowProps}
          />

          {categoryRows.map(([categoryName, list]) => (
            <VideoRow
              key={categoryName}
              title={categoryName}
              videos={list.slice(0, 12)}
              {...rowProps}
            />
          ))}
        </>
      )}

      <div className="feed-header">
        <div>
          <h3>Recommended for you</h3>
          <p>Stories you might enjoy</p>
        </div>

        <button
          className="view-all"
          onClick={() => navigate("/explore")}
        >
          View all →
        </button>
      </div>

      {loading && (
        <div className="feed-message">
          <div className="loading-spinner"></div>
          <p>Loading ReelVerse videos...</p>
        </div>
      )}

      {!loading && error && (
        <div className="feed-message error-message">
          <p>{error}</p>
          <small>
            Make sure the Flask backend is running on port 5000.
          </small>
        </div>
      )}

      {!loading && !error && (
        <VideoGrid
          videos={videos}
          openVideo={openVideo}
          openComments={openComments}
          commentsCount={commentsCount}
          likedVideos={likedVideos}
          onToggleLike={onToggleLike}
          likeLoading={likeLoading}
          bookmarkedVideos={bookmarkedVideos}
          onToggleBookmark={onToggleBookmark}
          bookmarkLoading={bookmarkLoading}
        />
      )}
    </>
  );
}


// =====================================================
// TRENDING PAGE
// =====================================================

function TrendingPage({
  openVideo,
  openComments,
  commentsCount,
  likedVideos,
  onToggleLike,
  likeLoading,
  bookmarkedVideos,
  onToggleBookmark,
  bookmarkLoading,
}) {
  const [trendingVideos, setTrendingVideos] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [trendingError, setTrendingError] = useState("");

  const loadTrendingVideos = async () => {
    try {
      setTrendingLoading(true);
      setTrendingError("");

      const response = await fetch("/api/trending");
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to load trending videos."
        );
      }

      setTrendingVideos(
        Array.isArray(data)
          ? data
          : Array.isArray(data.videos)
            ? data.videos
            : []
      );
    } catch (err) {
      console.error("Trending request failed:", err);
      setTrendingVideos([]);
      setTrendingError(
        err.message || "Unable to load trending videos."
      );
    } finally {
      setTrendingLoading(false);
    }
  };

  useEffect(() => {
    loadTrendingVideos();
  }, []);

  const handleTrendingLike = async (video) => {
    await onToggleLike(video);
    await loadTrendingVideos();
  };

  return (
    <div className="rv-page" style={{ padding: "40px 50px 60px" }}>
      <div
        style={{
          marginBottom: "30px",
        }}
      >
        <span className="hero-label">
          ✦ REELVERSE TRENDING
        </span>

        <h2
          style={{
            margin: "15px 0 8px",
            fontSize: "40px",
            color: "#ffffff",
          }}
        >
          Trending now.
        </h2>

        <p
          style={{
            margin: 0,
            color: "#888894",
            fontSize: "15px",
            lineHeight: "1.6",
          }}
        >
          Videos ranked by views, likes and comments across ReelVerse.
        </p>
      </div>

      {trendingLoading && (
        <div className="feed-message">
          <div className="loading-spinner"></div>
          <p>Loading trending videos...</p>
        </div>
      )}

      {!trendingLoading && trendingError && (
        <div className="feed-message error-message">
          <p>{trendingError}</p>
          <small>
            Make sure the Flask backend is running on port 5000.
          </small>
        </div>
      )}

      {!trendingLoading && !trendingError && (
        <>
          <div className="feed-header">
            <div>
              <h3>Trending Videos</h3>
              <p>
                {trendingVideos.length} video
                {trendingVideos.length !== 1 ? "s" : ""} • highest engagement first
              </p>
            </div>
          </div>

          <VideoGrid
            videos={trendingVideos}
            openVideo={openVideo}
            openComments={openComments}
            commentsCount={commentsCount}
            likedVideos={likedVideos}
            onToggleLike={handleTrendingLike}
            likeLoading={likeLoading}
            bookmarkedVideos={bookmarkedVideos}
            onToggleBookmark={onToggleBookmark}
            bookmarkLoading={bookmarkLoading}
          />
        </>
      )}
    </div>
  );
}


// =====================================================
// FOLLOWING PAGE
// Latest videos from the creators the user follows.
// =====================================================

function FollowingPage({
  authUser,
  onLoginNavigate,
  openVideo,
  openComments,
  commentsCount,
  likedVideos,
  onToggleLike,
  likeLoading,
  bookmarkedVideos,
  onToggleBookmark,
  bookmarkLoading,
}) {
  const navigate = useNavigate();

  const [followingVideos, setFollowingVideos] = useState([]);
  const [totalFollowing, setTotalFollowing] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [followingLoading, setFollowingLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [followingError, setFollowingError] = useState("");

  const FOLLOWING_PAGE_SIZE = 12;

  const fetchFollowingPage = async (page) => {
    const token = localStorage.getItem("access_token");

    const response = await fetch(
      `/api/feed/following?page=${page}&limit=${FOLLOWING_PAGE_SIZE}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message ||
          data.msg ||
          "Unable to load videos from creators you follow."
      );
    }

    return data;
  };

  const loadFirstPage = async () => {
    try {
      setFollowingLoading(true);
      setFollowingError("");

      const data = await fetchFollowingPage(1);

      setFollowingVideos(
        Array.isArray(data.videos) ? data.videos : []
      );
      setTotalFollowing(data.total_following || 0);
      setCurrentPage(1);
      setHasNext(Boolean(data.pagination?.has_next));
    } catch (err) {
      console.error("Following feed request failed:", err);
      setFollowingVideos([]);
      setFollowingError(
        err.message ||
          "Unable to load videos from creators you follow."
      );
    } finally {
      setFollowingLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasNext) {
      return;
    }

    try {
      setLoadingMore(true);

      const nextPage = currentPage + 1;
      const data = await fetchFollowingPage(nextPage);

      setFollowingVideos((currentVideos) => {
        const knownIds = new Set(
          currentVideos.map((item) => item.id)
        );

        return [
          ...currentVideos,
          ...(Array.isArray(data.videos) ? data.videos : []).filter(
            (item) => !knownIds.has(item.id)
          ),
        ];
      });
      setCurrentPage(nextPage);
      setHasNext(Boolean(data.pagination?.has_next));
    } catch (err) {
      console.error("Following feed load more failed:", err);
      setFollowingError(
        err.message || "Unable to load more videos."
      );
    } finally {
      setLoadingMore(false);
    }
  };

  // After a like, reload the pages already shown so counts stay correct.
  const refreshLoadedPages = async () => {
    try {
      let merged = [];
      let more = false;

      for (let page = 1; page <= currentPage; page += 1) {
        const data = await fetchFollowingPage(page);

        merged = merged.concat(
          Array.isArray(data.videos) ? data.videos : []
        );
        more = Boolean(data.pagination?.has_next);
      }

      setFollowingVideos(merged);
      setHasNext(more);
    } catch (err) {
      console.error("Following feed refresh failed:", err);
    }
  };

  const handleFollowingLike = async (video) => {
    await onToggleLike(video);
    await refreshLoadedPages();
  };

  useEffect(() => {
    if (authUser?.id) {
      loadFirstPage();
    } else {
      setFollowingLoading(false);
    }
  }, [authUser?.id]);

  // A deleted video disappears from this page too.
  useEffect(() => {
    const handleVideoDeleted = (event) => {
      const deletedId = event.detail && event.detail.id;

      setFollowingVideos((currentVideos) =>
        currentVideos.filter((item) => item.id !== deletedId)
      );
    };

    window.addEventListener("reelverse:video-deleted", handleVideoDeleted);

    return () => {
      window.removeEventListener(
        "reelverse:video-deleted",
        handleVideoDeleted
      );
    };
  }, []);

  if (!authUser) {
    return (
      <div
        style={{
          minHeight: "65vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "50px 20px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "520px" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>
            ♡
          </div>

          <h2 style={{ color: "#ffffff", margin: 0 }}>
            Videos from creators you follow
          </h2>

          <p
            style={{
              color: "#888894",
              lineHeight: "1.6",
              margin: "12px 0 22px",
            }}
          >
            Login to follow creators and see their newest videos here.
          </p>

          <button
            type="button"
            onClick={onLoginNavigate}
            style={authPrimaryButtonStyle}
          >
            Login to continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rv-page" style={{ padding: "40px 50px 60px" }}>
      <div className="feed-header">
        <div>
          <span className="hero-label">✦ YOUR CREATORS</span>

          <h3 style={{ marginTop: "14px" }}>Following</h3>

          <p>
            {totalFollowing > 0
              ? `Latest videos from the ${totalFollowing} creator${
                  totalFollowing !== 1 ? "s" : ""
                } you follow.`
              : "See the latest videos from creators you follow."}
          </p>
        </div>
      </div>

      {followingLoading && (
        <div className="feed-message">
          <div className="loading-spinner"></div>
          <p>Loading your following feed...</p>
        </div>
      )}

      {!followingLoading && followingError && (
        <div className="feed-message error-message">
          <p>{followingError}</p>
          <small>
            Make sure the Flask backend is running on port 5000.
          </small>
        </div>
      )}

      {!followingLoading &&
        !followingError &&
        totalFollowing === 0 && (
          <div className="feed-message">
            <div style={{ fontSize: "36px", marginBottom: "10px" }}>
              ♡
            </div>

            <p>You are not following anyone yet.</p>

            <small>
              Follow creators and their newest videos will show up here.
            </small>

            <div style={{ marginTop: "18px" }}>
              <button
                type="button"
                onClick={() => navigate("/explore")}
                style={authPrimaryButtonStyle}
              >
                Explore creators
              </button>
            </div>
          </div>
        )}

      {!followingLoading &&
        !followingError &&
        totalFollowing > 0 &&
        followingVideos.length === 0 && (
          <div className="feed-message">
            <div style={{ fontSize: "36px", marginBottom: "10px" }}>
              🎬
            </div>

            <p>No videos yet from the creators you follow.</p>

            <small>
              New uploads from them will appear here.
            </small>
          </div>
        )}

      {!followingLoading && followingVideos.length > 0 && (
        <>
          <VideoGrid
            videos={followingVideos}
            openVideo={openVideo}
            openComments={openComments}
            commentsCount={commentsCount}
            likedVideos={likedVideos}
            onToggleLike={handleFollowingLike}
            likeLoading={likeLoading}
            bookmarkedVideos={bookmarkedVideos}
            onToggleBookmark={onToggleBookmark}
            bookmarkLoading={bookmarkLoading}
          />

          {followingError && (
            <p
              style={{
                color: "#ff6b81",
                textAlign: "center",
                marginTop: "18px",
              }}
            >
              {followingError}
            </p>
          )}

          {hasNext && (
            <div style={{ textAlign: "center", marginTop: "28px" }}>
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  ...authPrimaryButtonStyle,
                  cursor: loadingMore ? "wait" : "pointer",
                  opacity: loadingMore ? 0.7 : 1,
                }}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}


// =====================================================
// EXPLORE PAGE
// =====================================================

function ExplorePage({
  videos,
  loading,
  error,
  openVideo,
  openComments,
  commentsCount,
  likedVideos,
  onToggleLike,
  likeLoading,
  bookmarkedVideos,
  onToggleBookmark,
  bookmarkLoading,
}) {
  const location = useLocation();

  const [selectedCategory, setSelectedCategory] =
    useState("All");

  const submittedSearch = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return (params.get("search") || "").trim();
  }, [location.search]);

  const [trendingVideos, setTrendingVideos] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [trendingError, setTrendingError] = useState("");

  const categories = useMemo(() => {
    const uniqueCategories = [
      ...new Set(
        videos
          .map((video) => video.category)
          .filter(Boolean)
      ),
    ];

    return ["All", "Trending", ...uniqueCategories];
  }, [videos]);

  useEffect(() => {
    const loadTrendingVideos = async () => {
      if (selectedCategory !== "Trending") {
        return;
      }

      try {
        setTrendingLoading(true);
        setTrendingError("");

        const response = await fetch("/api/trending");
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.message ||
              data.msg ||
              "Unable to load trending videos."
          );
        }

        setTrendingVideos(
          Array.isArray(data)
            ? data
            : Array.isArray(data.videos)
              ? data.videos
              : []
        );
      } catch (err) {
        console.error("Trending request failed:", err);
        setTrendingVideos([]);
        setTrendingError(
          err.message || "Unable to load trending videos."
        );
      } finally {
        setTrendingLoading(false);
      }
    };

    loadTrendingVideos();
  }, [selectedCategory]);

  const filteredVideos = useMemo(() => {
    let result =
      selectedCategory === "Trending"
        ? [...trendingVideos]
        : [...videos];

    if (
      selectedCategory !== "All" &&
      selectedCategory !== "Trending"
    ) {
      result = result.filter(
        (video) =>
          video.category?.toLowerCase() ===
          selectedCategory.toLowerCase()
      );
    }

    if (submittedSearch) {
      const keyword = submittedSearch.toLowerCase();

      result = result.filter((video) => {
        const title = video.title || "";
        const description = video.description || "";
        const creator = video.creator || "";
        const category = video.category || "";

        return (
          title.toLowerCase().includes(keyword) ||
          description.toLowerCase().includes(keyword) ||
          creator.toLowerCase().includes(keyword) ||
          category.toLowerCase().includes(keyword)
        );
      });
    }

    return result;
  }, [
    videos,
    trendingVideos,
    selectedCategory,
    submittedSearch,
  ]);

  const pageLoading =
    selectedCategory === "Trending"
      ? trendingLoading
      : loading;

  const pageError =
    selectedCategory === "Trending"
      ? trendingError
      : error;

  return (
    <div className="rv-page" style={{ padding: "40px 50px 60px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: "30px",
          flexWrap: "wrap",
          marginBottom: "30px",
        }}
      >
        <div>
          <span className="hero-label">
            ✦ EXPLORE REELVERSE
          </span>

          <h2
            style={{
              margin: "15px 0 8px",
              fontSize: "40px",
              color: "#ffffff",
            }}
          >
            Discover something new.
          </h2>

          <p
            style={{
              margin: 0,
              color: "#888894",
              fontSize: "15px",
            }}
          >
            Explore videos and discover creators worth following.
          </p>
        </div>

      </div>

      <div
        className="category-bar"
        style={{ marginBottom: "30px" }}
      >
        {categories.map((category) => (
          <button
            key={category}
            className={`category ${
              selectedCategory === category
                ? "active-category"
                : ""
            }`}
            onClick={() =>
              setSelectedCategory(category)
            }
          >
            {category}
          </button>
        ))}
      </div>

      {pageLoading && (
        <div className="feed-message">
          <div className="loading-spinner"></div>
          <p>
            {selectedCategory === "Trending"
              ? "Loading trending videos..."
              : "Loading Explore..."}
          </p>
        </div>
      )}

      {!pageLoading && pageError && (
        <div className="feed-message error-message">
          <p>{pageError}</p>
        </div>
      )}

      {!pageLoading && !pageError && (
        <>
          <div className="feed-header">
            <div>
              <h3>
                {selectedCategory === "All"
                  ? "All Videos"
                  : selectedCategory === "Trending"
                    ? "Trending Videos"
                    : selectedCategory}
              </h3>

              <p>
                {filteredVideos.length} video
                {filteredVideos.length !== 1 ? "s" : ""} found
                {selectedCategory === "Trending"
                  ? " • ranked by the ReelVerse backend"
                  : ""}
              </p>
            </div>
          </div>

          <VideoGrid
            videos={filteredVideos}
            openVideo={openVideo}
            openComments={openComments}
            commentsCount={commentsCount}
            likedVideos={likedVideos}
            onToggleLike={onToggleLike}
            likeLoading={likeLoading}
            bookmarkedVideos={bookmarkedVideos}
            onToggleBookmark={onToggleBookmark}
            bookmarkLoading={bookmarkLoading}
          />
        </>
      )}
    </div>
  );
}


// =====================================================
// BOOKMARKS PAGE
// =====================================================

function BookmarksPage({
  videos,
  authUser,
  openVideo,
  openComments,
  commentsCount,
  likedVideos,
  onToggleLike,
  likeLoading,
  bookmarkedVideos,
  onToggleBookmark,
  bookmarkLoading,
  onLoginNavigate,
}) {
  if (!authUser) {
    return (
      <div
        style={{
          minHeight: "65vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "50px 20px",
        }}
      >
        <div
          style={{
            textAlign: "center",
            maxWidth: "520px",
          }}
        >
          <div
            style={{
              fontSize: "48px",
              marginBottom: "16px",
            }}
          >
            🔖
          </div>

          <h2
            style={{
              color: "#ffffff",
              margin: 0,
            }}
          >
            Your saved videos
          </h2>

          <p
            style={{
              color: "#888894",
              lineHeight: "1.6",
              margin: "12px 0 22px",
            }}
          >
            Login to save videos and access your bookmarks from
            anywhere.
          </p>

          <button
            type="button"
            onClick={onLoginNavigate}
            style={authPrimaryButtonStyle}
          >
            Login to continue
          </button>
        </div>
      </div>
    );
  }

  const savedVideos = videos.filter(
    (video) => Boolean(bookmarkedVideos[video.id])
  );

  return (
    <div className="rv-page" style={{ padding: "40px 50px 60px" }}>
      <div className="feed-header">
        <div>
          <span className="hero-label">
            ✦ YOUR COLLECTION
          </span>

          <h3 style={{ marginTop: "14px" }}>
            Saved Videos
          </h3>

          <p>
            Videos you bookmarked for later.
          </p>
        </div>
      </div>

      {savedVideos.length === 0 ? (
        <div className="feed-message">
          <div
            style={{
              fontSize: "36px",
              marginBottom: "10px",
            }}
          >
            🔖
          </div>

          <p>
            No bookmarked videos yet.
          </p>

          <small>
            Tap 🔖 Save on a video to keep it here.
          </small>
        </div>
      ) : (
        <VideoGrid
          videos={savedVideos}
          openVideo={openVideo}
          openComments={openComments}
          commentsCount={commentsCount}
          likedVideos={likedVideos}
          onToggleLike={onToggleLike}
          likeLoading={likeLoading}
          bookmarkedVideos={bookmarkedVideos}
          onToggleBookmark={onToggleBookmark}
          bookmarkLoading={bookmarkLoading}
        />
      )}
    </div>
  );
}


// =====================================================
// WATCH HISTORY PAGE
// =====================================================

function HistoryPage({
  authUser,
  historyVideos,
  historyLoading,
  historyError,
  openVideo,
  openComments,
  commentsCount,
  likedVideos,
  onToggleLike,
  likeLoading,
  bookmarkedVideos,
  onToggleBookmark,
  bookmarkLoading,
  onClearHistory,
  onLoginNavigate,
}) {
  if (!authUser) {
    return (
      <div
        style={{
          minHeight: "65vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "50px 20px",
        }}
      >
        <div
          style={{
            textAlign: "center",
            maxWidth: "520px",
          }}
        >
          <div
            style={{
              fontSize: "48px",
              marginBottom: "16px",
            }}
          >
            ◷
          </div>

          <h2
            style={{
              color: "#ffffff",
              margin: 0,
            }}
          >
            Your watch history
          </h2>

          <p
            style={{
              color: "#888894",
              lineHeight: "1.6",
              margin: "12px 0 22px",
            }}
          >
            Login to keep track of the videos you watch on
            ReelVerse.
          </p>

          <button
            type="button"
            onClick={onLoginNavigate}
            style={authPrimaryButtonStyle}
          >
            Login to continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rv-page" style={{ padding: "40px 50px 60px" }}>
      <div
        className="feed-header"
        style={{
          alignItems: "center",
          gap: "20px",
        }}
      >
        <div>
          <span className="hero-label">
            ✦ YOUR ACTIVITY
          </span>

          <h3 style={{ marginTop: "14px" }}>
            Watch History
          </h3>

          <p>
            Videos you've recently watched.
          </p>
        </div>

        {historyVideos.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            style={{
              border: "1px solid #3a3038",
              background: "#18181f",
              color: "#ff8a9b",
              borderRadius: "9px",
              padding: "10px 14px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            Clear history
          </button>
        )}
      </div>

      {historyLoading && (
        <div className="feed-message">
          <div className="loading-spinner"></div>

          <p>
            Loading your watch history...
          </p>
        </div>
      )}

      {!historyLoading && historyError && (
        <div className="feed-message error-message">
          <p>{historyError}</p>
        </div>
      )}

      {!historyLoading &&
        !historyError &&
        historyVideos.length === 0 && (
          <div className="feed-message">
            <div
              style={{
                fontSize: "36px",
                marginBottom: "10px",
              }}
            >
              ◷
            </div>

            <p>
              Your watch history is empty.
            </p>

            <small>
              Open a video and it will appear here automatically.
            </small>
          </div>
        )}

      {!historyLoading &&
        !historyError &&
        historyVideos.length > 0 && (
          <VideoGrid
            videos={historyVideos}
            openVideo={openVideo}
            openComments={openComments}
            commentsCount={commentsCount}
            likedVideos={likedVideos}
            onToggleLike={onToggleLike}
            likeLoading={likeLoading}
            bookmarkedVideos={bookmarkedVideos}
            onToggleBookmark={onToggleBookmark}
            bookmarkLoading={bookmarkLoading}
          />
        )}
    </div>
  );
}


// =====================================================
// MY VIDEOS PAGE
// =====================================================

function MyVideosPage({
  videos,
  authUser,
  openVideo,
  openComments,
  commentsCount,
  likedVideos,
  onToggleLike,
  likeLoading,
  bookmarkedVideos,
  onToggleBookmark,
  bookmarkLoading,
  onLoginNavigate,
}) {
  const [myVideos, setMyVideos] = useState([]);
  const [myVideosLoading, setMyVideosLoading] = useState(true);
  const [myVideosError, setMyVideosError] = useState("");

  // ---------------------------------------------------
  // LOAD CURRENT USER'S VIDEOS FROM BACKEND
  // ---------------------------------------------------

  useEffect(() => {
    const loadMyVideos = async () => {
      if (!authUser) {
        setMyVideos([]);
        setMyVideosError("");
        setMyVideosLoading(false);
        return;
      }

      const token = localStorage.getItem("access_token");

      if (!token) {
        setMyVideos([]);
        setMyVideosError(
          "Your login session is missing. Please login again."
        );
        setMyVideosLoading(false);
        return;
      }

      try {
        setMyVideosLoading(true);
        setMyVideosError("");

        const response = await fetch("/api/my-videos", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.message ||
              data.msg ||
              "Unable to load your videos."
          );
        }

        const videoList = Array.isArray(data) ? data : [];

        setMyVideos(
          videoList.map((video) => ({
            ...video,
            creator: video.creator || authUser.username,
          }))
        );
      } catch (err) {
        console.error("My Videos request failed:", err);
        setMyVideos([]);
        setMyVideosError(
          err.message || "Unable to load your videos."
        );
      } finally {
        setMyVideosLoading(false);
      }
    };

    loadMyVideos();
  }, [authUser]);

  // A deleted video disappears from this page and from the counts.
  useEffect(() => {
    const handleVideoDeleted = (event) => {
      const deletedId = event.detail && event.detail.id;

      setMyVideos((currentVideos) =>
        currentVideos.filter((item) => item.id !== deletedId)
      );
    };

    window.addEventListener("reelverse:video-deleted", handleVideoDeleted);

    return () => {
      window.removeEventListener(
        "reelverse:video-deleted",
        handleVideoDeleted
      );
    };
  }, []);

  // ---------------------------------------------------
  // LOGIN CHECK
  // ---------------------------------------------------

  if (!authUser) {
    return (
      <div
        style={{
          minHeight: "65vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "50px 20px",
        }}
      >
        <div
          style={{
            textAlign: "center",
            maxWidth: "520px",
          }}
        >
          <div
            style={{
              fontSize: "48px",
              marginBottom: "16px",
            }}
          >
            ▣
          </div>

          <h2
            style={{
              color: "#ffffff",
              margin: 0,
            }}
          >
            Your videos
          </h2>

          <p
            style={{
              color: "#888894",
              lineHeight: "1.6",
              margin: "12px 0 22px",
            }}
          >
            Login to view the videos you have uploaded to
            ReelVerse.
          </p>

          <button
            type="button"
            onClick={onLoginNavigate}
            style={authPrimaryButtonStyle}
          >
            Login to continue
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------
  // KEEP COUNTS IN SYNC WITH THE MAIN VIDEO STATE
  // ---------------------------------------------------

  const displayVideos = myVideos.map((myVideo) => {
    const latestVideo = videos.find(
      (video) => video.id === myVideo.id
    );

    return latestVideo
      ? {
          ...myVideo,
          ...latestVideo,
          creator:
            latestVideo.creator ||
            myVideo.creator ||
            authUser.username,
        }
      : myVideo;
  });

  // ---------------------------------------------------
  // CALCULATE CREATOR STATS
  // ---------------------------------------------------

  const totalViews = displayVideos.reduce(
    (total, video) => total + (video.views || 0),
    0
  );

  const totalLikes = displayVideos.reduce(
    (total, video) => total + (video.likes || 0),
    0
  );

  return (
    <div className="rv-page" style={{ padding: "40px 50px 60px" }}>
      {/* -------------------------------------------------
          PAGE HEADER
      ------------------------------------------------- */}

      <div
        style={{
          marginBottom: "30px",
        }}
      >
        <span className="hero-label">
          ✦ YOUR CONTENT
        </span>

        <h2
          style={{
            margin: "15px 0 8px",
            fontSize: "40px",
            color: "#ffffff",
          }}
        >
          My Videos
        </h2>

        <p
          style={{
            margin: 0,
            color: "#888894",
            fontSize: "15px",
          }}
        >
          Manage and watch the videos you have uploaded.
        </p>
      </div>

      {/* -------------------------------------------------
          LOADING STATE
      ------------------------------------------------- */}

      {myVideosLoading && (
        <div className="feed-message">
          <div className="loading-spinner"></div>
          <p>Loading your videos...</p>
        </div>
      )}

      {/* -------------------------------------------------
          ERROR STATE
      ------------------------------------------------- */}

      {!myVideosLoading && myVideosError && (
        <div className="feed-message error-message">
          <p>{myVideosError}</p>
          <small>
            If your session expired, logout and login again.
          </small>
        </div>
      )}

      {!myVideosLoading && !myVideosError && (
        <>
          {/* -------------------------------------------------
              CREATOR STATS
          ------------------------------------------------- */}

          <div
            className="rv-pstats"
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "14px",
              marginBottom: "35px",
            }}
          >
            <div
              className="rv-pstat"
              style={{
                background: "#111116",
                border: "1px solid #292932",
                borderRadius: "14px",
                padding: "18px",
              }}
            >
              <p
                style={{
                  margin: 0,
                  color: "#777783",
                  fontSize: "12px",
                }}
              >
                Videos
              </p>

              <h3
                style={{
                  margin: "7px 0 0",
                  color: "#ffffff",
                  fontSize: "25px",
                }}
              >
                {displayVideos.length}
              </h3>
            </div>

            <div
              className="rv-pstat"
              style={{
                background: "#111116",
                border: "1px solid #292932",
                borderRadius: "14px",
                padding: "18px",
              }}
            >
              <p
                style={{
                  margin: 0,
                  color: "#777783",
                  fontSize: "12px",
                }}
              >
                Total Views
              </p>

              <h3
                style={{
                  margin: "7px 0 0",
                  color: "#ffffff",
                  fontSize: "25px",
                }}
              >
                {totalViews}
              </h3>
            </div>

            <div
              className="rv-pstat"
              style={{
                background: "#111116",
                border: "1px solid #292932",
                borderRadius: "14px",
                padding: "18px",
              }}
            >
              <p
                style={{
                  margin: 0,
                  color: "#777783",
                  fontSize: "12px",
                }}
              >
                Total Likes
              </p>

              <h3
                style={{
                  margin: "7px 0 0",
                  color: "#ffffff",
                  fontSize: "25px",
                }}
              >
                {totalLikes}
              </h3>
            </div>
          </div>

          {/* -------------------------------------------------
              VIDEO SECTION
          ------------------------------------------------- */}

          <div className="feed-header">
            <div>
              <h3>
                {displayVideos.length > 0
                  ? "Your uploaded videos"
                  : "No uploaded videos"}
              </h3>

              <p>
                {displayVideos.length > 0
                  ? `${displayVideos.length} video${
                      displayVideos.length !== 1 ? "s" : ""
                    } uploaded by ${authUser.username}.`
                  : "Your uploaded videos will appear here."}
              </p>
            </div>
          </div>

          {/* -------------------------------------------------
              EMPTY STATE
          ------------------------------------------------- */}

          {displayVideos.length === 0 && (
            <div
              className="feed-message"
              style={{
                marginTop: "20px",
              }}
            >
              <div
                style={{
                  fontSize: "40px",
                  marginBottom: "10px",
                }}
              >
                🎬
              </div>

              <p>
                You haven't uploaded any videos yet.
              </p>

              <small>
                Your videos will appear here after you upload them.
              </small>
            </div>
          )}

          {/* -------------------------------------------------
              MY VIDEO GRID
          ------------------------------------------------- */}

          {displayVideos.length > 0 && (
            <VideoGrid
              videos={displayVideos}
              openVideo={openVideo}
              openComments={openComments}
              commentsCount={commentsCount}
              likedVideos={likedVideos}
              onToggleLike={onToggleLike}
              likeLoading={likeLoading}
              bookmarkedVideos={bookmarkedVideos}
              onToggleBookmark={onToggleBookmark}
              bookmarkLoading={bookmarkLoading}
            />
          )}
        </>
      )}
    </div>
  );
}



// =====================================================
// MESSAGES / INBOX + CHAT PAGE
// =====================================================

function MessagesPage({ authUser, onLoginNavigate }) {
  const navigate = useNavigate();
  const { conversationId } = useParams();

  const [conversations, setConversations] = useState([]);
  const [conversationSearch, setConversationSearch] = useState("");
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState("");

  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");

  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const [mediaUploading, setMediaUploading] = useState(false);
  const [openedMedia, setOpenedMedia] = useState(null);
  const mediaInputRef = useRef(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [otherUserOnline, setOtherUserOnline] = useState(false);
  const [otherUserLastActive, setOtherUserLastActive] = useState(null);
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState(null);

  // Pin / delete chat: pins are personal (the other person never sees them).
  const [pinnedMessageIds, setPinnedMessageIds] = useState([]);
  const [openChatMenu, setOpenChatMenu] = useState(null);
  const [inboxNotice, setInboxNotice] = useState("");
  const inboxNoticeTimerRef = useRef(null);

  const socketRef = useRef(null);
  const typingTimerRef = useRef(null);
  const messageRefs = useRef({});
  const messagesEndRef = useRef(null);
  const highlightTimerRef = useRef(null);

  const filteredConversations = conversations.filter(
    (conversation) =>
      (conversation.other_user?.username || "")
        .toLowerCase()
        .includes(conversationSearch.trim().toLowerCase())
  );

  const token = localStorage.getItem("access_token");

  const loadInbox = async () => {
    if (!authUser || !token) {
      setConversations([]);
      setInboxLoading(false);
      return;
    }

    try {
      setInboxLoading(true);
      setInboxError("");

      const response = await fetch("/api/messages/conversations", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to load your conversations."
        );
      }

      setConversations(
        Array.isArray(data.conversations) ? data.conversations : []
      );
    } catch (err) {
      console.error("Inbox request failed:", err);
      setInboxError(
        err.message || "Unable to load your conversations."
      );
    } finally {
      setInboxLoading(false);
    }
  };

  const loadConversation = async (id) => {
    if (!authUser || !token || !id) {
      setActiveConversation(null);
      setMessages([]);
      return;
    }

    try {
      setChatLoading(true);
      setChatError("");

      const response = await fetch(
        `/api/messages/conversations/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to load this conversation."
        );
      }

      setActiveConversation(data.conversation || null);
      setMessages(
        Array.isArray(data.messages) ? data.messages : []
      );
      setPinnedMessageIds(
        Array.isArray(data.pinned_message_ids)
          ? data.pinned_message_ids.map(Number)
          : []
      );

      const readResponse = await fetch(
        `/api/messages/conversations/${id}/read`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (readResponse.ok) {
        const readData = await readResponse.json().catch(() => ({}));

        if ((readData.marked_read || 0) > 0) {
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              Number(message.receiver_id) === Number(authUser.id) &&
              !message.is_read
                ? {
                    ...message,
                    is_read: true,
                    read_at: readData.read_at || message.read_at,
                  }
                : message
            )
          );
        }

        await loadInbox();
      }
    } catch (err) {
      console.error("Conversation request failed:", err);
      setChatError(
        err.message || "Unable to load this conversation."
      );
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    loadInbox();
  }, [authUser]);

  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
    } else {
      setActiveConversation(null);
      setMessages([]);
      setPinnedMessageIds([]);
      setChatError("");
    }

    setOpenChatMenu(null);
    setReplyingTo(null);
  }, [conversationId, authUser]);

  // STEP 13C: open a loaded conversation at its newest message.
  useEffect(() => {
    if (!conversationId || chatLoading || messages.length === 0) {
      return undefined;
    }

    const scrollTimer = window.setTimeout(() => {
      // Scroll only the message list (not the whole page), so the
      // person's name bar stays on screen.
      let scroller = messagesEndRef.current?.parentElement;

      while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) {
        scroller = scroller.parentElement;
      }

      if (scroller && scroller !== document.body && scroller !== document.documentElement) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    }, 50);

    return () => {
      window.clearTimeout(scrollTimer);
    };
  }, [conversationId, chatLoading]);

  useEffect(() => {
    if (!authUser?.id || !token) {
      setSocketConnected(false);
      return undefined;
    }

    const socket = io(SOCKET_URL, {
      auth: {
        token,
      },
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);

      if (conversationId) {
        socket.emit("join_conversation", {
          conversation_id: Number(conversationId),
        });
      }

      if (activeConversation?.other_user?.id) {
        socket.emit("presence_request", {
          user_id: Number(activeConversation.other_user.id),
        });
      }
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
    });

    socket.on("new_message", async (payload) => {
      const incomingMessage = payload?.message;

      if (!incomingMessage?.id) {
        return;
      }

      const activeId = Number(conversationId);
      const incomingConversationId = Number(
        incomingMessage.conversation_id
      );

      if (activeId === incomingConversationId) {
        setMessages((currentMessages) => {
          const alreadyExists = currentMessages.some(
            (message) =>
              Number(message.id) === Number(incomingMessage.id)
          );

          return alreadyExists
            ? currentMessages
            : [...currentMessages, incomingMessage];
        });

        if (
          Number(incomingMessage.receiver_id) ===
          Number(authUser.id)
        ) {
          try {
            await fetch(
              `/api/messages/conversations/${incomingConversationId}/read`,
              {
                method: "PUT",
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            );
          } catch (err) {
            console.error(
              "Real-time read update failed:",
              err
            );
          }
        }
      }

      loadInbox();
    });

    socket.on("message_unsent", (payload) => {
      const unsentMessage = payload?.message;

      if (!unsentMessage?.id) {
        return;
      }

      if (
        Number(payload?.conversation_id) ===
        Number(conversationId)
      ) {
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            Number(message.id) === Number(unsentMessage.id)
              ? unsentMessage
              : message
          )
        );

        setPinnedMessageIds((currentIds) =>
          currentIds.filter(
            (pinnedId) => pinnedId !== Number(unsentMessage.id)
          )
        );

        setReplyingTo((currentReply) =>
          Number(currentReply?.id) === Number(unsentMessage.id)
            ? null
            : currentReply
        );
      }

      loadInbox();
    });

    socket.on("message_reaction_updated", (payload) => {
      const updatedMessage = payload?.message;

      if (!updatedMessage?.id) {
        return;
      }

      if (
        Number(payload?.conversation_id) ===
        Number(conversationId)
      ) {
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            Number(message.id) === Number(updatedMessage.id)
              ? updatedMessage
              : message
          )
        );
      }

      loadInbox();
    });

    socket.on("messages_read", (payload) => {
      if (
        Number(payload?.conversation_id) !==
        Number(conversationId)
      ) {
        loadInbox();
        return;
      }

      const readIds = new Set(
        (payload?.message_ids || []).map(Number)
      );

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          readIds.has(Number(message.id))
            ? {
                ...message,
                is_read: true,
                read_at:
                  payload.read_at || message.read_at,
              }
            : message
        )
      );

      loadInbox();
    });

    socket.on("presence_update", (payload) => {
      const otherUserId = Number(
        activeConversation?.other_user?.id
      );

      if (
        otherUserId &&
        Number(payload?.user_id) === otherUserId
      ) {
        setOtherUserOnline(Boolean(payload.online));
        setOtherUserLastActive(payload.last_active || null);

        if (!payload.online) {
          setOtherUserTyping(false);
        }
      }
    });

    socket.on("typing_update", (payload) => {
      if (
        Number(payload?.conversation_id) ===
          Number(conversationId) &&
        Number(payload?.user_id) ===
          Number(activeConversation?.other_user?.id)
      ) {
        setOtherUserTyping(Boolean(payload.is_typing));
      }
    });

    socket.on("connect_error", (err) => {
      console.error("Socket connection failed:", err);
      setSocketConnected(false);
    });

    return () => {
      if (conversationId) {
        socket.emit("leave_conversation", {
          conversation_id: Number(conversationId),
        });
      }

      socket.disconnect();

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }

      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, [authUser?.id, conversationId, activeConversation?.other_user?.id]);

  useEffect(() => {
    const otherUserId = activeConversation?.other_user?.id;

    setOtherUserTyping(false);

    if (!otherUserId || !socketRef.current?.connected) {
      return;
    }

    socketRef.current.emit("presence_request", {
      user_id: Number(otherUserId),
    });
  }, [activeConversation?.other_user?.id]);

  const emitTyping = (isTyping) => {
    if (
      !conversationId ||
      !socketRef.current?.connected
    ) {
      return;
    }

    socketRef.current.emit("typing", {
      conversation_id: Number(conversationId),
      is_typing: isTyping,
    });
  };

  const handleMessageInputChange = (event) => {
    const value = event.target.value;

    setMessageText(value);

    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }

    if (!value.trim()) {
      emitTyping(false);
      typingTimerRef.current = null;
      return;
    }

    emitTyping(true);

    typingTimerRef.current = setTimeout(() => {
      emitTyping(false);
      typingTimerRef.current = null;
    }, 1200);
  };

  const formatLastActive = (value) => {
    if (!value) {
      return "Offline";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Offline";
    }

    const seconds = Math.max(
      0,
      Math.floor((Date.now() - date.getTime()) / 1000)
    );

    if (seconds < 60) {
      return "Active just now";
    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) {
      return `Active ${minutes}m ago`;
    }

    const hours = Math.floor(minutes / 60);

    if (hours < 24) {
      return `Active ${hours}h ago`;
    }

    const days = Math.floor(hours / 24);

    return `Active ${days}d ago`;
  };

  const openConversation = (id) => {
    navigate(`/messages/${id}`);
  };

  // Close the chat menu when clicking anywhere else.
  useEffect(() => {
    if (openChatMenu === null) {
      return undefined;
    }

    const closeMenu = () => setOpenChatMenu(null);

    document.addEventListener("click", closeMenu);

    return () => {
      document.removeEventListener("click", closeMenu);
    };
  }, [openChatMenu]);

  const showInboxNotice = (text) => {
    setInboxNotice(text);

    if (inboxNoticeTimerRef.current) {
      clearTimeout(inboxNoticeTimerRef.current);
    }

    inboxNoticeTimerRef.current = setTimeout(() => {
      setInboxNotice("");
      inboxNoticeTimerRef.current = null;
    }, 4500);
  };

  const togglePinChat = async (targetConversationId, shouldPin) => {
    setOpenChatMenu(null);

    if (!targetConversationId || !token) {
      return;
    }

    try {
      const response = await fetch(
        `/api/messages/conversations/${targetConversationId}/pin`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ pinned: shouldPin }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || data.msg || "Unable to update this pin."
        );
      }

      setActiveConversation((currentConversation) =>
        currentConversation &&
        Number(currentConversation.id) === Number(targetConversationId)
          ? { ...currentConversation, is_pinned: Boolean(data.is_pinned) }
          : currentConversation
      );

      await loadInbox();
    } catch (err) {
      console.error("Pin chat failed:", err);
      showInboxNotice(err.message || "Unable to update this pin.");
    }
  };

  const deleteConversationForMe = async (
    targetConversationId,
    username
  ) => {
    setOpenChatMenu(null);

    if (!targetConversationId || !token) {
      return;
    }

    const confirmed = window.confirm(
      `Delete your chat with ${username || "this person"}? ` +
        "The whole chat is removed for you only. " +
        "They will still have their copy, and if you message again " +
        "the chat starts fresh."
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `/api/messages/conversations/${targetConversationId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || data.msg || "Unable to delete this chat."
        );
      }

      setConversations((currentConversations) =>
        currentConversations.filter(
          (item) => Number(item.id) !== Number(targetConversationId)
        )
      );

      if (Number(conversationId) === Number(targetConversationId)) {
        setActiveConversation(null);
        setMessages([]);
        setPinnedMessageIds([]);
        setReplyingTo(null);
        navigate("/messages");
      }

      showInboxNotice("Chat deleted. The other person still has it.");
    } catch (err) {
      console.error("Delete chat failed:", err);
      showInboxNotice(err.message || "Unable to delete this chat.");
    }
  };

  const togglePinMessage = async (message) => {
    if (!message?.id || message.is_unsent || !token) {
      return;
    }

    const shouldPin = !pinnedMessageIds.includes(Number(message.id));

    setChatError("");

    try {
      const response = await fetch(
        `/api/messages/${message.id}/pin`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ pinned: shouldPin }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || data.msg || "Unable to pin this message."
        );
      }

      setPinnedMessageIds(
        Array.isArray(data.pinned_message_ids)
          ? data.pinned_message_ids.map(Number)
          : []
      );
    } catch (err) {
      console.error("Pin message failed:", err);
      setChatError(err.message || "Unable to pin this message.");
    }
  };

  // The small menu used by the inbox rows and the chat header.
  const renderChatMenu = (
    targetConversationId,
    isPinned,
    username,
    positionStyle
  ) => (
    <div
      role="menu"
      onClick={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        zIndex: 40,
        minWidth: "170px",
        padding: "6px",
        border: "1px solid #30303a",
        borderRadius: "12px",
        background: "#121217",
        boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
        ...positionStyle,
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() =>
          togglePinChat(targetConversationId, !isPinned)
        }
        style={{
          width: "100%",
          border: "none",
          borderRadius: "8px",
          background: "transparent",
          color: "#ffffff",
          padding: "10px 12px",
          textAlign: "left",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: "650",
        }}
      >
        {isPinned ? "📌 Unpin chat" : "📌 Pin chat"}
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() =>
          deleteConversationForMe(targetConversationId, username)
        }
        style={{
          width: "100%",
          border: "none",
          borderRadius: "8px",
          background: "transparent",
          color: "#ff6b81",
          padding: "10px 12px",
          textAlign: "left",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: "650",
        }}
      >
        🗑 Delete chat
      </button>
    </div>
  );

  const handleSendMessage = async (event) => {
    event.preventDefault();

    const content = messageText.trim();

    if (
      !content ||
      !activeConversation?.id ||
      !token ||
      sending
    ) {
      return;
    }

    try {
      setSending(true);
      setChatError("");

      const response = await fetch(
        `/api/messages/conversations/${activeConversation.id}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content,
            reply_to_id: replyingTo?.id || null,
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to send message."
        );
      }

      setMessageText("");
      setReplyingTo(null);
      emitTyping(false);

      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }

      if (data.data) {
        setMessages((currentMessages) => {
          const alreadyExists = currentMessages.some(
            (message) =>
              Number(message.id) === Number(data.data.id)
          );

          return alreadyExists
            ? currentMessages
            : [...currentMessages, data.data];
        });
      }

      await loadInbox();
    } catch (err) {
      console.error("Send message failed:", err);
      setChatError(
        err.message || "Unable to send message."
      );
    } finally {
      setSending(false);
    }
  };

  const clearSelectedMedia = () => {
    if (mediaPreviewUrl) {
      URL.revokeObjectURL(mediaPreviewUrl);
    }

    setSelectedMedia(null);
    setMediaPreviewUrl("");

    if (mediaInputRef.current) {
      mediaInputRef.current.value = "";
    }
  };

  const handleMediaSelect = (event) => {
    const file = event.target.files?.[0] || null;

    if (!file) {
      return;
    }

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const extension = `.${file.name.split(".").pop()?.toLowerCase() || ""}`;
    const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    const videoExtensions = [".mp4", ".mov", ".webm", ".mkv"];

    if (
      !isImage &&
      !isVideo &&
      !imageExtensions.includes(extension) &&
      !videoExtensions.includes(extension)
    ) {
      setChatError("Please choose a supported image or video file.");
      event.target.value = "";
      return;
    }

    if (mediaPreviewUrl) {
      URL.revokeObjectURL(mediaPreviewUrl);
    }

    setChatError("");
    setSelectedMedia(file);
    setMediaPreviewUrl(URL.createObjectURL(file));
  };

  const handleSendMedia = async () => {
    if (
      !selectedMedia ||
      !activeConversation?.id ||
      !token ||
      mediaUploading
    ) {
      return;
    }

    const formData = new FormData();
    formData.append("media", selectedMedia);

    if (messageText.trim()) {
      formData.append("content", messageText.trim());
    }

    if (replyingTo?.id) {
      formData.append("reply_to_id", String(replyingTo.id));
    }

    try {
      setMediaUploading(true);
      setChatError("");
      emitTyping(false);

      const response = await fetch(
        `/api/messages/conversations/${activeConversation.id}/media`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            data.error ||
            "Unable to send media."
        );
      }

      setMessageText("");
      clearSelectedMedia();
      setReplyingTo(null);

      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }

      if (data.data) {
        setMessages((currentMessages) => {
          const alreadyExists = currentMessages.some(
            (message) => Number(message.id) === Number(data.data.id)
          );

          return alreadyExists
            ? currentMessages
            : [...currentMessages, data.data];
        });
      }

      await loadInbox();
    } catch (err) {
      console.error("Send media failed:", err);
      setChatError(err.message || "Unable to send media.");
    } finally {
      setMediaUploading(false);
    }
  };

  const handleComposerSubmit = async (event) => {
    event.preventDefault();

    if (selectedMedia) {
      await handleSendMedia();
      return;
    }

    await handleSendMessage(event);
  };

  const jumpToOriginalMessage = (replyToId) => {
    if (!replyToId) return;

    const targetId = Number(replyToId);
    const targetElement = messageRefs.current[targetId];

    if (!targetElement) {
      setChatError(
        "The original message is not currently available in this chat."
      );
      return;
    }

    setChatError("");
    targetElement.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    setHighlightedMessageId(targetId);

    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }

    highlightTimerRef.current = setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimerRef.current = null;
    }, 1800);
  };

  const getReplyPreviewText = (message) => {
    if (!message) return "Original message";

    if (message.is_unsent) {
      return "Message unsent";
    }

    if (message.message_type === "image") {
      return message.content
        ? `📷 ${message.content}`
        : "📷 Photo";
    }

    if (message.message_type === "video") {
      return message.content
        ? `🎥 ${message.content}`
        : "🎥 Video";
    }

    return message.content || "Original message";
  };

  const startReply = (message) => {
    if (!message?.id || message.is_unsent) {
      return;
    }

    setReplyingTo(message);
    setChatError("");
  };

  const cancelReply = () => {
    setReplyingTo(null);
  };

  const reactionOptions = ["❤️", "😂", "😮", "😢", "👍", "🔥"];

  const getMyReaction = (message) => {
    const reactions = Array.isArray(message?.reactions)
      ? message.reactions
      : [];

    return (
      reactions.find(
        (reaction) =>
          Number(reaction.user_id) === Number(authUser?.id)
      ) || null
    );
  };

  const toggleReactionPicker = (message) => {
    if (!message?.id || message.is_unsent) {
      return;
    }

    setReactionPickerMessageId((currentId) =>
      Number(currentId) === Number(message.id)
        ? null
        : Number(message.id)
    );
    setChatError("");
  };

  const setMessageReaction = async (message, reactionValue) => {
    if (!message?.id || message.is_unsent || !token) {
      return;
    }

    const myReaction = getMyReaction(message);
    const shouldRemove =
      myReaction?.reaction === reactionValue;

    setChatError("");

    // Optimistic update so the reaction changes immediately on this screen.
    const previousMessages = messages;

    setMessages((currentMessages) =>
      currentMessages.map((item) => {
        if (Number(item.id) !== Number(message.id)) {
          return item;
        }

        const currentReactions = Array.isArray(item.reactions)
          ? item.reactions
          : [];

        const reactionsWithoutMine = currentReactions.filter(
          (reaction) =>
            Number(reaction.user_id) !== Number(authUser?.id)
        );

        if (shouldRemove) {
          return {
            ...item,
            reactions: reactionsWithoutMine,
          };
        }

        return {
          ...item,
          reactions: [
            ...reactionsWithoutMine,
            {
              id: myReaction?.id || `temp-${authUser?.id}-${item.id}`,
              user_id: authUser?.id,
              reaction: reactionValue,
              created_at: new Date().toISOString(),
            },
          ],
        };
      })
    );

    try {
      const response = await fetch(
        `/api/messages/${message.id}/reaction`,
        {
          method: shouldRemove ? "DELETE" : "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            ...(shouldRemove
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(shouldRemove
            ? {}
            : {
                body: JSON.stringify({
                  reaction: reactionValue,
                }),
              }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data?.message || "Unable to update reaction."
        );
      }

      if (data?.data?.id) {
        setMessages((currentMessages) =>
          currentMessages.map((item) =>
            Number(item.id) === Number(data.data.id)
              ? data.data
              : item
          )
        );
      }
    } catch (err) {
      console.error("Message reaction failed:", err);

      // Restore the previous chat state if the request fails.
      setMessages(previousMessages);

      setChatError(
        err.message || "Unable to update reaction."
      );
    }
  };

  const deleteMessageForMe = async (message) => {
    if (!message?.id) {
      return;
    }

    const confirmed = window.confirm(
      "Delete this message for you? The other person will still be able to see it."
    );

    if (!confirmed) {
      return;
    }

    setChatError("");

    try {
      const response = await fetch(
        `/api/messages/${message.id}/delete-for-me`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.message || "Unable to delete this message."
        );
      }

      setMessages((currentMessages) =>
        currentMessages.filter(
          (item) => Number(item.id) !== Number(message.id)
        )
      );

      if (Number(replyingTo?.id) === Number(message.id)) {
        setReplyingTo(null);
      }

      setPinnedMessageIds((currentIds) =>
        currentIds.filter(
          (pinnedId) => pinnedId !== Number(message.id)
        )
      );

      delete messageRefs.current[Number(message.id)];
      loadInbox();
    } catch (err) {
      console.error("Delete for me failed:", err);
      setChatError(
        err.message || "Unable to delete this message."
      );
    }
  };

  const unsendMessage = async (message) => {
    if (
      !message?.id ||
      message.is_unsent ||
      Number(message.sender_id) !== Number(authUser?.id)
    ) {
      return;
    }

    const confirmed = window.confirm(
      "Unsend this message for everyone?"
    );

    if (!confirmed) {
      return;
    }

    setChatError("");

    try {
      const response = await fetch(
        `/api/messages/${message.id}/unsend`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.message || "Unable to unsend this message."
        );
      }

      const unsentMessage = data?.data;

      if (unsentMessage?.id) {
        setPinnedMessageIds((currentIds) =>
          currentIds.filter(
            (pinnedId) => pinnedId !== Number(unsentMessage.id)
          )
        );
      }

      if (unsentMessage?.id) {
        setMessages((currentMessages) =>
          currentMessages.map((item) =>
            Number(item.id) === Number(unsentMessage.id)
              ? unsentMessage
              : item
          )
        );
      }

      if (Number(replyingTo?.id) === Number(message.id)) {
        setReplyingTo(null);
      }

      loadInbox();
    } catch (err) {
      console.error("Unsend message failed:", err);
      setChatError(
        err.message || "Unable to unsend this message."
      );
    }
  };

  const downloadMedia = async (url, messageType) => {
    if (!url) return;

    const safeType = messageType === "video" ? "video" : "image";
    const filename = `reelverse-${safeType}-${Date.now()}`;

    try {
      // Cloudinary supports the fl_attachment delivery flag.
      // Unlike the normal media URL, this tells the browser to download
      // the file instead of opening/playing it in a new tab.
      if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
        const attachmentUrl = url.replace(
          "/upload/",
          `/upload/fl_attachment:${filename}/`
        );

        const link = document.createElement("a");
        link.href = attachmentUrl;
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }

      // Fallback for non-Cloudinary media URLs.
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Download failed");
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 1000);
    } catch (err) {
      console.error("Media download failed:", err);
      setChatError("Unable to download this media file.");
    }
  };

  const formatMessageTime = (value) => {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  // STEP 15A: compact latest-message time for inbox rows.
  const formatInboxMessageTime = (value) => {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const startOfMessageDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );

    const dayDifference = Math.round(
      (startOfToday - startOfMessageDay) / 86400000
    );

    if (dayDifference === 0) {
      return date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      });
    }

    if (dayDifference === 1) {
      return "Yesterday";
    }

    if (dayDifference > 1 && dayDifference < 7) {
      return date.toLocaleDateString([], {
        weekday: "short",
      });
    }

    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  };

  const latestOutgoingReadMessageId = [...messages]
    .reverse()
    .find(
      (message) =>
        Number(message.sender_id) === Number(authUser?.id) &&
        message.is_read
    )?.id;

  if (!authUser) {
    return (
      <div
        style={{
          minHeight: "65vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "50px 20px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "520px" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>
            ✉
          </div>

          <h2 style={{ color: "#ffffff", margin: 0 }}>
            Messages
          </h2>

          <p
            style={{
              color: "#888894",
              lineHeight: "1.6",
              margin: "12px 0 22px",
            }}
          >
            Login to view and reply to your ReelVerse messages.
          </p>

          <button
            type="button"
            onClick={onLoginNavigate}
            style={authPrimaryButtonStyle}
          >
            Login to continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rv-page"
      style={{
        padding: "28px 32px 50px",
        minHeight: "calc(100vh - 64px)",
      }}
    >
      <div
        style={{
          marginBottom: "22px",
        }}
      >
        <span className="hero-label">✦ REELVERSE DIRECT</span>

        <h2
          style={{
            margin: "12px 0 6px",
            color: "#ffffff",
            fontSize: "32px",
          }}
        >
          Messages
        </h2>

        <p
          style={{
            margin: 0,
            color: "#888894",
            fontSize: "14px",
          }}
        >
          Private conversations with other ReelVerse creators.
        </p>
      </div>

      <div
        className="messages-shell"
        style={{
          minHeight: "650px",
          display: "grid",
          gridTemplateColumns: "340px minmax(0, 1fr)",
          background: "#0f0f14",
          border: "1px solid #292932",
          borderRadius: "18px",
          overflow: "hidden",
        }}
      >
        <aside
          className="messages-inbox-panel"
          style={{
            borderRight: "1px solid #292932",
            background: "#111116",
          }}
        >
          <div
            style={{
              padding: "18px",
              borderBottom: "1px solid #292932",
            }}
          >
            <h3
              style={{
                margin: 0,
                color: "#ffffff",
                fontSize: "17px",
              }}
            >
              Inbox
            </h3>

            <p
              style={{
                margin: "5px 0 0",
                color: "#777783",
                fontSize: "12px",
              }}
            >
              {conversations.length} conversation
              {conversations.length !== 1 ? "s" : ""}
            </p>
          </div>

          {!inboxLoading &&
            !inboxError &&
            conversations.length > 0 && (
              <div
                style={{
                  padding: "12px 14px",
                  borderBottom: "1px solid #202028",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "9px",
                    padding: "10px 12px",
                    border: "1px solid #292932",
                    borderRadius: "10px",
                    background: "#0d0d12",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      color: "#777783",
                      fontSize: "15px",
                    }}
                  >
                    ⌕
                  </span>

                  <input
                    type="text"
                    value={conversationSearch}
                    onChange={(event) =>
                      setConversationSearch(event.target.value)
                    }
                    placeholder="Search messages..."
                    aria-label="Search conversations"
                    style={{
                      width: "100%",
                      minWidth: 0,
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      color: "#ffffff",
                      fontSize: "13px",
                    }}
                  />
                </div>
              </div>
            )}

          {inboxLoading && (
            <div className="feed-message" style={{ margin: "24px 16px" }}>
              <div className="loading-spinner"></div>
              <p>Loading conversations...</p>
            </div>
          )}

          {!inboxLoading && inboxError && (
            <div
              className="feed-message error-message"
              style={{ margin: "24px 16px" }}
            >
              <p>{inboxError}</p>
            </div>
          )}

          {!inboxLoading &&
            !inboxError &&
            conversations.length === 0 && (
              <div
                style={{
                  padding: "40px 22px",
                  textAlign: "center",
                  color: "#777783",
                }}
              >
                <div
                  style={{
                    fontSize: "34px",
                    marginBottom: "12px",
                  }}
                >
                  ✉
                </div>

                <p
                  style={{
                    color: "#d0d0d7",
                    margin: "0 0 6px",
                    fontWeight: "700",
                  }}
                >
                  No conversations yet
                </p>

                <small>
                  Open another creator's profile and tap Message.
                </small>
              </div>
            )}

          {!inboxLoading &&
            !inboxError &&
            conversations.length > 0 &&
            filteredConversations.length === 0 && (
              <div
                style={{
                  padding: "30px 20px",
                  textAlign: "center",
                  color: "#777783",
                  fontSize: "13px",
                }}
              >
                No conversations found
              </div>
            )}

          {inboxNotice && (
            <div
              role="status"
              style={{
                margin: "10px 14px 0",
                padding: "10px 12px",
                border: "1px solid #30303a",
                borderRadius: "10px",
                background: "#17171d",
                color: "#d8d8df",
                fontSize: "12px",
                lineHeight: "1.5",
              }}
            >
              {inboxNotice}
            </div>
          )}

          {!inboxLoading &&
            !inboxError &&
            filteredConversations.map((conversation, rowIndex) => {
              const otherUser = conversation.other_user;
              const lastMessage = conversation.last_message;
              const isActive =
                Number(conversationId) === Number(conversation.id);
              const latestMessageTime =
                formatInboxMessageTime(
                  lastMessage?.created_at ||
                    conversation.updated_at
                );
              const lastMessageIsMine =
                Boolean(lastMessage) &&
                Number(lastMessage.sender_id) ===
                  Number(authUser?.id);

              const lastMessagePreview = lastMessage?.is_unsent
                ? "Message unsent"
                : lastMessage?.message_type === "image"
                  ? lastMessage?.content
                    ? `📷 ${lastMessage.content}`
                    : "📷 Photo"
                  : lastMessage?.message_type === "video"
                    ? lastMessage?.content
                      ? `🎥 ${lastMessage.content}`
                      : "🎥 Video"
                    : lastMessage?.content || "Start chatting";

              const latestReaction =
                conversation.latest_reaction || null;
              const reactionTime = latestReaction?.created_at
                ? new Date(latestReaction.created_at).getTime()
                : 0;
              const messageTime = lastMessage?.created_at
                ? new Date(lastMessage.created_at).getTime()
                : 0;
              const showReactionPreview =
                Boolean(latestReaction?.reaction) &&
                reactionTime >= messageTime;

              const reactedMessagePreview =
                latestReaction?.message_type === "image"
                  ? "📷 Photo"
                  : latestReaction?.message_type === "video"
                    ? "🎥 Video"
                    : latestReaction?.message_content || "Message";

              const inboxPreview = showReactionPreview
                ? `${
                    Number(latestReaction.user_id) ===
                    Number(authUser?.id)
                      ? "You reacted"
                      : "Reacted"
                  } ${latestReaction.reaction} to "${reactedMessagePreview}"`
                : lastMessageIsMine && lastMessage
                  ? `You: ${lastMessagePreview}`
                  : lastMessagePreview;

              return (
                <div
                  key={conversation.id}
                  style={{ position: "relative" }}
                >
                <button
                  type="button"
                  onClick={() =>
                    openConversation(conversation.id)
                  }
                  className="conversation-row"
                  style={{
                    width: "100%",
                    border: "none",
                    borderBottom: "1px solid #202028",
                    background: isActive
                      ? "rgba(124,58,237,0.14)"
                      : "transparent",
                    color: "#ffffff",
                    textAlign: "left",
                    cursor: "pointer",
                    padding: "15px 38px 15px 16px",
                    display: "flex",
                    gap: "12px",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      width: "46px",
                      height: "46px",
                      flex: "0 0 46px",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background:
                        "linear-gradient(135deg, #7c3aed, #c04cff)",
                      fontWeight: "800",
                      fontSize: "18px",
                      overflow: "hidden",
                    }}
                  >
                    {otherUser?.profile_photo_url ? (
                      <img
                        src={otherUser.profile_photo_url}
                        alt={`${otherUser?.username || "User"} profile`}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                          const fallback =
                            event.currentTarget.nextElementSibling;
                          if (fallback) {
                            fallback.style.display = "flex";
                          }
                        }}
                      />
                    ) : null}

                    <span
                      style={{
                        width: "100%",
                        height: "100%",
                        alignItems: "center",
                        justifyContent: "center",
                        display: otherUser?.profile_photo_url
                          ? "none"
                          : "flex",
                      }}
                    >
                      {(otherUser?.username || "U")
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                  </div>

                  <div
                    style={{
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "10px",
                        alignItems: "center",
                      }}
                    >
                      <strong
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: "14px",
                        }}
                      >
                        {otherUser?.username || "Unknown user"}
                        {conversation.is_pinned && (
                          <span title="Pinned chat"> 📌</span>
                        )}
                      </strong>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexShrink: 0,
                        }}
                      >
                        {latestMessageTime && (
                          <span
                            style={{
                              color:
                                conversation.unread_count > 0
                                  ? "#b79cff"
                                  : "#777783",
                              fontSize: "11px",
                              fontWeight:
                                conversation.unread_count > 0
                                  ? "700"
                                  : "500",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {latestMessageTime}
                          </span>
                        )}

                        {conversation.unread_count > 0 && (
                          <span
                            style={{
                              minWidth: "21px",
                              height: "21px",
                              padding: "0 6px",
                              borderRadius: "999px",
                              background: "#8b5cf6",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#ffffff",
                              fontSize: "11px",
                              fontWeight: "800",
                            }}
                          >
                            {conversation.unread_count}
                          </span>
                        )}
                      </div>
                    </div>

                    <p
                      style={{
                        margin: "5px 0 0",
                        color:
                          conversation.unread_count > 0
                            ? "#d8d8df"
                            : "#777783",
                        fontSize: "12px",
                        fontWeight:
                          conversation.unread_count > 0 ? "700" : "400",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {inboxPreview}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  aria-label="Chat options"
                  title="Chat options"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenChatMenu((current) =>
                      current === conversation.id ? null : conversation.id
                    );
                  }}
                  style={{
                    position: "absolute",
                    top: "50%",
                    right: "6px",
                    transform: "translateY(-50%)",
                    width: "26px",
                    height: "30px",
                    border: "none",
                    borderRadius: "8px",
                    background: "transparent",
                    color: "#9a9aa6",
                    fontSize: "18px",
                    lineHeight: 1,
                    cursor: "pointer",
                  }}
                >
                  ⋮
                </button>

                {openChatMenu === conversation.id &&
                  renderChatMenu(
                    conversation.id,
                    Boolean(conversation.is_pinned),
                    otherUser?.username,
                    {
                      right: "34px",
                      ...(rowIndex > 0 &&
                      rowIndex === filteredConversations.length - 1
                        ? { bottom: "8px" }
                        : { top: "8px" }),
                    }
                  )}
                </div>
              );
            })}
        </aside>

        <section
          className="messages-chat-panel"
          style={{
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            background: "#0d0d12",
          }}
        >
          {!conversationId && (
            <div
              style={{
                flex: 1,
                minHeight: "650px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "30px",
                textAlign: "center",
              }}
            >
              <div style={{ maxWidth: "400px" }}>
                <div
                  style={{
                    width: "78px",
                    height: "78px",
                    borderRadius: "50%",
                    border: "1px solid #34343d",
                    margin: "0 auto 18px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "34px",
                  }}
                >
                  ✉
                </div>

                <h3
                  style={{
                    color: "#ffffff",
                    margin: "0 0 8px",
                    fontSize: "22px",
                  }}
                >
                  Your messages
                </h3>

                <p
                  style={{
                    margin: 0,
                    color: "#777783",
                    lineHeight: "1.6",
                  }}
                >
                  Select a conversation from the inbox to start chatting.
                </p>
              </div>
            </div>
          )}

          {conversationId && (
            <>
              <div
                style={{
                  minHeight: "72px",
                  padding: "12px 18px",
                  borderBottom: "1px solid #292932",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  background: "#111116",
                }}
              >
                <button
                  type="button"
                  className="messages-mobile-back"
                  onClick={() => navigate("/messages")}
                  aria-label="Back to inbox"
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#ffffff",
                    fontSize: "22px",
                    cursor: "pointer",
                    padding: "6px",
                  }}
                >
                  ‹
                </button>

                <div
                  style={{
                    width: "42px",
                    height: "42px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background:
                      "linear-gradient(135deg, #7c3aed, #c04cff)",
                    color: "#ffffff",
                    fontWeight: "800",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  {activeConversation?.other_user?.profile_photo_url ? (
                    <img
                      src={activeConversation.other_user.profile_photo_url}
                      alt={`${activeConversation?.other_user?.username || "User"} profile`}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                        const fallback =
                          event.currentTarget.nextElementSibling;
                        if (fallback) {
                          fallback.style.display = "flex";
                        }
                      }}
                    />
                  ) : null}

                  <span
                    style={{
                      width: "100%",
                      height: "100%",
                      alignItems: "center",
                      justifyContent: "center",
                      display:
                        activeConversation?.other_user?.profile_photo_url
                          ? "none"
                          : "flex",
                    }}
                  >
                    {(activeConversation?.other_user?.username || "U")
                      .charAt(0)
                      .toUpperCase()}
                  </span>
                </div>

                <div style={{ minWidth: 0 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeConversation?.other_user?.id) {
                        navigate(
                          `/users/${activeConversation.other_user.id}`
                        );
                      }
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#ffffff",
                      padding: 0,
                      cursor: "pointer",
                      fontSize: "15px",
                      fontWeight: "800",
                    }}
                  >
                    {activeConversation?.other_user?.username ||
                      "Conversation"}
                  </button>

                  <p
                    style={{
                      margin: "3px 0 0",
                      color: otherUserTyping
                        ? "#c084fc"
                        : otherUserOnline
                          ? "#8fd6a5"
                          : "#70707a",
                      fontSize: "11px",
                    }}
                  >
                    {otherUserTyping
                      ? `${activeConversation?.other_user?.username || "User"} is typing...`
                      : otherUserOnline
                        ? "● Online"
                        : formatLastActive(otherUserLastActive)}
                  </p>
                </div>

                <div
                  style={{
                    marginLeft: "auto",
                    position: "relative",
                    flexShrink: 0,
                  }}
                >
                  <button
                    type="button"
                    aria-label="Chat options"
                    title="Chat options"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenChatMenu((current) =>
                        current === "header" ? null : "header"
                      );
                    }}
                    style={{
                      width: "34px",
                      height: "34px",
                      border: "none",
                      borderRadius: "50%",
                      background: "transparent",
                      color: "#c8c8d2",
                      fontSize: "20px",
                      lineHeight: 1,
                      cursor: "pointer",
                    }}
                  >
                    ⋮
                  </button>

                  {openChatMenu === "header" &&
                    renderChatMenu(
                      Number(conversationId),
                      Boolean(activeConversation?.is_pinned),
                      activeConversation?.other_user?.username,
                      { right: 0, top: "40px" }
                    )}
                </div>
              </div>

              {pinnedMessageIds.length > 0 && (
                <div
                  style={{
                    padding: "8px 18px",
                    borderBottom: "1px solid #292932",
                    background: "#14141b",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  {pinnedMessageIds.map((pinnedId) => {
                    const pinnedMessage = messages.find(
                      (item) => Number(item.id) === Number(pinnedId)
                    );

                    if (!pinnedMessage) {
                      return null;
                    }

                    const pinnedByMe =
                      Number(pinnedMessage.sender_id) ===
                      Number(authUser?.id);

                    return (
                      <div
                        key={pinnedId}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          fontSize: "12px",
                          color: "#d8d8df",
                        }}
                      >
                        <span aria-hidden="true">📌</span>

                        <button
                          type="button"
                          onClick={() => jumpToOriginalMessage(pinnedId)}
                          title="Go to this message"
                          style={{
                            flex: 1,
                            minWidth: 0,
                            border: "none",
                            background: "transparent",
                            color: "inherit",
                            padding: "3px 0",
                            textAlign: "left",
                            cursor: "pointer",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontSize: "12px",
                          }}
                        >
                          <strong style={{ color: "#b79cff" }}>
                            {pinnedByMe
                              ? "You"
                              : pinnedMessage.sender_username || "User"}
                            :
                          </strong>{" "}
                          {getReplyPreviewText(pinnedMessage)}
                        </button>

                        <button
                          type="button"
                          onClick={() => togglePinMessage(pinnedMessage)}
                          aria-label="Unpin message"
                          title="Unpin message"
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "#888894",
                            cursor: "pointer",
                            fontSize: "16px",
                            lineHeight: 1,
                            padding: "2px 4px",
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  padding: "22px",
                }}
              >
                {chatLoading && (
                  <div className="feed-message">
                    <div className="loading-spinner"></div>
                    <p>Loading messages...</p>
                  </div>
                )}

                {!chatLoading && chatError && (
                  <div className="feed-message error-message">
                    <p>{chatError}</p>
                  </div>
                )}

                {!chatLoading &&
                  !chatError &&
                  messages.length === 0 && (
                    <div
                      style={{
                        minHeight: "420px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        textAlign: "center",
                        color: "#777783",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: "34px",
                            marginBottom: "10px",
                          }}
                        >
                          ✦
                        </div>
                        <p style={{ margin: 0 }}>
                          Start the conversation.
                        </p>
                      </div>
                    </div>
                  )}

                {!chatLoading &&
                  messages.map((message) => {
                    const mine =
                      Number(message.sender_id) === Number(authUser?.id);

                    return (
                      <div
                        key={message.id}
                        ref={(element) => {
                          if (element) {
                            messageRefs.current[Number(message.id)] = element;
                          } else {
                            delete messageRefs.current[Number(message.id)];
                          }
                        }}
                        style={{
                          display: "flex",
                          justifyContent: mine
                            ? "flex-end"
                            : "flex-start",
                          flexDirection: "row",
                          alignItems: "flex-end",
                          gap: "8px",
                          marginBottom: "12px",
                          padding: "4px 6px",
                          marginLeft: "-6px",
                          marginRight: "-6px",
                          borderRadius: "14px",
                          background:
                            Number(highlightedMessageId) === Number(message.id)
                              ? "rgba(168,85,247,0.22)"
                              : "transparent",
                          boxShadow:
                            Number(highlightedMessageId) === Number(message.id)
                              ? "0 0 0 1px rgba(192,132,252,0.55), 0 0 24px rgba(168,85,247,0.18)"
                              : "none",
                          transition:
                            "background 220ms ease, box-shadow 220ms ease",
                        }}
                      >
                        {(() => {
                          const messageUser = mine
                            ? authUser
                            : activeConversation?.other_user;

                          const messageUserId = messageUser?.id;
                          const messageUsername =
                            messageUser?.username ||
                            message.sender_username ||
                            "User";
                          const messageProfilePhotoUrl =
                            messageUser?.profile_photo_url || null;

                          return (
                            <button
                              type="button"
                              onClick={() => {
                                if (messageUserId) {
                                  navigate(`/users/${messageUserId}`);
                                }
                              }}
                              title={`View ${messageUsername}'s profile`}
                              aria-label={`View ${messageUsername}'s profile`}
                              style={{
                                width: "34px",
                                height: "34px",
                                borderRadius: "50%",
                                border: "1px solid #343440",
                                padding: 0,
                                flexShrink: 0,
                                overflow: "hidden",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background:
                                  "linear-gradient(135deg, #7c3aed, #a855f7)",
                                color: "#ffffff",
                                fontSize: "13px",
                                fontWeight: "800",
                                cursor: messageUserId ? "pointer" : "default",
                                order: mine ? 2 : 0,
                              }}
                            >
                              {messageProfilePhotoUrl ? (
                                <img
                                  src={messageProfilePhotoUrl}
                                  alt={`${messageUsername} profile`}
                                  style={{
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    display: "block",
                                  }}
                                  onError={(event) => {
                                    event.currentTarget.style.display = "none";
                                    const fallback =
                                      event.currentTarget.nextElementSibling;
                                    if (fallback) {
                                      fallback.style.display = "flex";
                                    }
                                  }}
                                />
                              ) : null}

                              <span
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  display: messageProfilePhotoUrl
                                    ? "none"
                                    : "flex",
                                }}
                              >
                                {messageUsername.charAt(0).toUpperCase()}
                              </span>
                            </button>
                          );
                        })()}

                        <div
                          style={{
                            maxWidth: "72%",
                            padding: "10px 13px",
                            borderRadius: mine
                              ? "17px 17px 4px 17px"
                              : "17px 17px 17px 4px",
                            background: mine
                              ? "linear-gradient(135deg, #7c3aed, #a855f7)"
                              : "#1a1a22",
                            border: mine
                              ? "none"
                              : "1px solid #292932",
                            color: "#ffffff",
                            wordBreak: "break-word",
                          }}
                        >
                          {message.reply_to_id && (
                            <button
                              type="button"
                              onClick={() =>
                                jumpToOriginalMessage(message.reply_to_id)
                              }
                              title="Go to original message"
                              style={{
                                display: "block",
                                width: "100%",
                                marginBottom: "8px",
                                padding: "7px 9px",
                                border: "none",
                                borderLeft:
                                  "3px solid rgba(255,255,255,0.55)",
                                borderRadius: "9px",
                                background: "rgba(0,0,0,0.18)",
                                color: "#ffffff",
                                textAlign: "left",
                                cursor: "pointer",
                                fontFamily: "inherit",
                                fontSize: "11px",
                                lineHeight: "1.35",
                                opacity: 0.9,
                              }}
                            >
                              {(() => {
                                const originalMessage = messages.find(
                                  (item) =>
                                    Number(item.id) ===
                                    Number(message.reply_to_id)
                                );

                                return (
                                  <>
                                    <div
                                      style={{
                                        fontWeight: "800",
                                        marginBottom: "2px",
                                      }}
                                    >
                                      {originalMessage
                                        ? originalMessage.sender_username
                                        : "Reply"}
                                    </div>
                                    <div
                                      style={{
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        maxWidth: "240px",
                                      }}
                                    >
                                      {getReplyPreviewText(originalMessage)}
                                    </div>
                                  </>
                                );
                              })()}
                            </button>
                          )}

                          {message.is_unsent ? (
                            <p
                              style={{
                                margin: 0,
                                fontSize: "14px",
                                lineHeight: "1.45",
                                opacity: 0.75,
                              }}
                            >
                              Message unsent
                            </p>
                          ) : (
                            <>
                              {message.message_type === "image" &&
                                message.media_url && (
                                  <div style={{ position: "relative" }}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOpenedMedia({
                                          type: "image",
                                          url: message.media_url,
                                        })
                                      }
                                      style={{
                                        display: "block",
                                        border: "none",
                                        padding: 0,
                                        background: "transparent",
                                        cursor: "zoom-in",
                                        width: "100%",
                                      }}
                                      title="Open image"
                                    >
                                      <img
                                        src={message.media_url}
                                        alt="Shared in ReelVerse chat"
                                        loading="lazy"
                                        style={{
                                          display: "block",
                                          width: "min(280px, 100%)",
                                          maxHeight: "360px",
                                          objectFit: "cover",
                                          borderRadius: "13px",
                                        }}
                                      />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() =>
                                        downloadMedia(message.media_url, "image")
                                      }
                                      title="Download image"
                                      style={{
                                        position: "absolute",
                                        right: "8px",
                                        bottom: "8px",
                                        width: "32px",
                                        height: "32px",
                                        borderRadius: "50%",
                                        border: "1px solid rgba(255,255,255,0.22)",
                                        background: "rgba(0,0,0,0.68)",
                                        color: "#ffffff",
                                        cursor: "pointer",
                                      }}
                                    >
                                      ↓
                                    </button>
                                  </div>
                                )}

                              {message.message_type === "video" &&
                                message.media_url && (
                                  <div>
                                    <video
                                      src={message.media_url}
                                      controls
                                      preload="metadata"
                                      style={{
                                        display: "block",
                                        width: "min(320px, 100%)",
                                        maxHeight: "380px",
                                        borderRadius: "13px",
                                        background: "#000000",
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        downloadMedia(message.media_url, "video")
                                      }
                                      style={{
                                        marginTop: "7px",
                                        border: "none",
                                        background: "transparent",
                                        color: "#ffffff",
                                        cursor: "pointer",
                                        fontSize: "11px",
                                        opacity: 0.85,
                                        padding: 0,
                                      }}
                                    >
                                      ↓ Download video
                                    </button>
                                  </div>
                                )}

                              {message.content && (
                                <p
                                  style={{
                                    margin:
                                      message.media_url ? "8px 0 0" : 0,
                                    fontSize: "14px",
                                    lineHeight: "1.45",
                                  }}
                                >
                                  {message.content}
                                </p>
                              )}
                            </>
                          )}

                          {!message.is_unsent && (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: mine
                                  ? "flex-end"
                                  : "flex-start",
                                gap: "12px",
                                marginTop: "7px",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => startReply(message)}
                                title="Reply to this message"
                              style={{
                                display: "block",
                                marginTop: "7px",
                                marginLeft: mine ? "auto" : 0,
                                border: "none",
                                background: "transparent",
                                color: "#ffffff",
                                cursor: "pointer",
                                padding: 0,
                                fontSize: "10px",
                                fontWeight: "700",
                                opacity: 0.78,
                              }}
                              >
                                ↩ Reply
                              </button>

                              {mine && (
                                <button
                                  type="button"
                                  onClick={() => unsendMessage(message)}
                                  title="Unsend this message"
                                  style={{
                                    border: "none",
                                    background: "transparent",
                                    color: "#ffffff",
                                    cursor: "pointer",
                                    padding: 0,
                                    fontSize: "10px",
                                    fontWeight: "700",
                                    opacity: 0.78,
                                  }}
                                >
                                  Unsend
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => toggleReactionPicker(message)}
                                title="React to this message"
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "#ffffff",
                                  cursor: "pointer",
                                  padding: 0,
                                  fontSize: "10px",
                                  fontWeight: "700",
                                  opacity: 0.78,
                                }}
                              >
                                ☺ React
                              </button>

                              <button
                                type="button"
                                onClick={() => togglePinMessage(message)}
                                title={
                                  pinnedMessageIds.includes(Number(message.id))
                                    ? "Unpin this message"
                                    : "Pin this message (only you see pins)"
                                }
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "#ffffff",
                                  cursor: "pointer",
                                  padding: 0,
                                  fontSize: "10px",
                                  fontWeight: "700",
                                  opacity: 0.78,
                                }}
                              >
                                {pinnedMessageIds.includes(Number(message.id))
                                  ? "📌 Unpin"
                                  : "📌 Pin"}
                              </button>

                              <button
                                type="button"
                                onClick={() => deleteMessageForMe(message)}
                                title="Delete this message only for you"
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "#ffffff",
                                  cursor: "pointer",
                                  padding: 0,
                                  fontSize: "10px",
                                  fontWeight: "700",
                                  opacity: 0.78,
                                }}
                              >
                                Delete for me
                              </button>
                            </div>
                          )}

                          {!message.is_unsent &&
                            Number(reactionPickerMessageId) ===
                              Number(message.id) && (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "5px",
                                  marginTop: "8px",
                                  padding: "6px 7px",
                                  width: "fit-content",
                                  marginLeft: mine ? "auto" : 0,
                                  borderRadius: "18px",
                                  background: "#0f0f15",
                                  border: "1px solid #34343f",
                                  boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                                  position: "relative",
                                  zIndex: 20,
                                  pointerEvents: "auto",
                                }}
                              >
                                {reactionOptions.map((reactionValue) => {
                                  const myReaction = getMyReaction(message);
                                  const selected =
                                    myReaction?.reaction === reactionValue;

                                  return (
                                    <button
                                      key={reactionValue}
                                      type="button"
                                      onPointerDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();

                                        const selectedReaction =
                                          reactionValue;

                                        // Close first, then run the API action.
                                        setReactionPickerMessageId(null);

                                        setTimeout(() => {
                                          setMessageReaction(
                                            message,
                                            selectedReaction
                                          );
                                        }, 0);
                                      }}
                                      title={
                                        selected
                                          ? "Remove your reaction"
                                          : `React ${reactionValue}`
                                      }
                                      style={{
                                        width: "30px",
                                        height: "30px",
                                        borderRadius: "50%",
                                        border: selected
                                          ? "1px solid #c084fc"
                                          : "1px solid transparent",
                                        background: selected
                                          ? "rgba(168,85,247,0.22)"
                                          : "transparent",
                                        cursor: "pointer",
                                        fontSize: "17px",
                                        padding: 0,
                                        position: "relative",
                                        zIndex: 21,
                                        pointerEvents: "auto",
                                        touchAction: "manipulation",
                                      }}
                                    >
                                      {reactionValue}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                          {!message.is_unsent &&
                            Array.isArray(message.reactions) &&
                            message.reactions.length > 0 && (() => {
                              const groupedReactions =
                                message.reactions.reduce(
                                  (groups, reaction) => {
                                    const emoji = reaction.reaction;

                                    if (!groups[emoji]) {
                                      groups[emoji] = [];
                                    }

                                    groups[emoji].push(reaction);
                                    return groups;
                                  },
                                  {}
                                );

                              return (
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "5px",
                                    marginTop: "7px",
                                    justifyContent: mine
                                      ? "flex-end"
                                      : "flex-start",
                                  }}
                                >
                                  {Object.entries(groupedReactions).map(
                                    ([emoji, reactions]) => {
                                      const mineInGroup = reactions.some(
                                        (reaction) =>
                                          Number(reaction.user_id) ===
                                          Number(authUser?.id)
                                      );

                                      return (
                                        <button
                                          key={emoji}
                                          type="button"
                                          onPointerDown={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();

                                            if (mineInGroup) {
                                              setReactionPickerMessageId(null);

                                              setTimeout(() => {
                                                setMessageReaction(
                                                  message,
                                                  emoji
                                                );
                                              }, 0);
                                            } else {
                                              toggleReactionPicker(message);
                                            }
                                          }}
                                          title={
                                            mineInGroup
                                              ? "Remove your reaction"
                                              : "React to this message"
                                          }
                                          style={{
                                            border: mineInGroup
                                              ? "1px solid #c084fc"
                                              : "1px solid #3a3a46",
                                            background: mineInGroup
                                              ? "rgba(168,85,247,0.20)"
                                              : "rgba(0,0,0,0.22)",
                                            color: "#ffffff",
                                            borderRadius: "14px",
                                            minWidth: "30px",
                                            height: "25px",
                                            padding: "1px 7px",
                                            cursor: "pointer",
                                            fontSize: "14px",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: "4px",
                                            position: "relative",
                                            zIndex: 10,
                                            pointerEvents: "auto",
                                          }}
                                        >
                                          <span>{emoji}</span>
                                          {reactions.length > 1 && (
                                            <span
                                              style={{
                                                fontSize: "10px",
                                                fontWeight: "800",
                                                color: "#e8e8ee",
                                              }}
                                            >
                                              {reactions.length}
                                            </span>
                                          )}
                                        </button>
                                      );
                                    }
                                  )}
                                </div>
                              );
                            })()}

                          {message.is_unsent && (
                            <button
                              type="button"
                              onClick={() => deleteMessageForMe(message)}
                              title="Delete this message only for you"
                              style={{
                                display: "block",
                                marginTop: "7px",
                                marginLeft: mine ? "auto" : 0,
                                border: "none",
                                background: "transparent",
                                color: "#ffffff",
                                cursor: "pointer",
                                padding: 0,
                                fontSize: "10px",
                                fontWeight: "700",
                                opacity: 0.78,
                              }}
                            >
                              Delete for me
                            </button>
                          )}

                          <div
                            style={{
                              marginTop: "5px",
                              fontSize: "9px",
                              opacity: 0.7,
                              textAlign: "right",
                            }}
                          >
                            {formatMessageTime(message.created_at)}
                          </div>

                          {mine &&
                            message.id === latestOutgoingReadMessageId && (
                              <div
                                style={{
                                  marginTop: "4px",
                                  fontSize: "9px",
                                  opacity: 0.8,
                                  textAlign: "right",
                                }}
                              >
                                Seen
                              </div>
                            )}
                        </div>
                      </div>
                    );
                  })}
              </div>

                            <div
                ref={messagesEndRef}
                aria-hidden="true"
                style={{ height: "1px" }}
              />

{replyingTo && (
                <div
                  style={{
                    padding: "10px 16px",
                    borderTop: "1px solid #292932",
                    background: "#14141b",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      minWidth: 0,
                      borderLeft: "3px solid #a855f7",
                      paddingLeft: "10px",
                    }}
                  >
                    <div
                      style={{
                        color: "#c084fc",
                        fontSize: "11px",
                        fontWeight: "800",
                        marginBottom: "3px",
                      }}
                    >
                      Replying to {replyingTo.sender_username}
                    </div>
                    <div
                      style={{
                        color: "#cfcfd8",
                        fontSize: "12px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "520px",
                      }}
                    >
                      {getReplyPreviewText(replyingTo)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={cancelReply}
                    title="Cancel reply"
                    aria-label="Cancel reply"
                    style={{
                      flex: "0 0 auto",
                      border: "none",
                      background: "transparent",
                      color: "#888894",
                      cursor: "pointer",
                      fontSize: "20px",
                      padding: "4px",
                    }}
                  >
                    ×
                  </button>
                </div>
              )}

              <form
                onSubmit={handleComposerSubmit}
                style={{
                  padding: "14px 16px",
                  borderTop: "1px solid #292932",
                  background: "#111116",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <input
                  ref={mediaInputRef}
                  type="file"
                  accept="image/*,video/*,.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm,.mkv"
                  onChange={handleMediaSelect}
                  style={{ display: "none" }}
                />

                <button
                  type="button"
                  onClick={() => mediaInputRef.current?.click()}
                  disabled={sending || mediaUploading}
                  title="Attach image or video"
                  aria-label="Attach image or video"
                  style={{
                    width: "40px",
                    height: "40px",
                    flex: "0 0 40px",
                    borderRadius: "50%",
                    border: "1px solid #30303a",
                    background: "#17171e",
                    color: "#c084fc",
                    cursor:
                      sending || mediaUploading ? "wait" : "pointer",
                    fontSize: "19px",
                  }}
                >
                  ＋
                </button>

                {selectedMedia && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      maxWidth: "150px",
                      padding: "5px 7px",
                      borderRadius: "10px",
                      border: "1px solid #30303a",
                      background: "#17171e",
                    }}
                  >
                    {selectedMedia.type.startsWith("video/") ||
                    [".mp4", ".mov", ".webm", ".mkv"].some(
                      (extension) =>
                        selectedMedia.name.toLowerCase().endsWith(extension)
                    ) ? (
                      <video
                        src={mediaPreviewUrl}
                        muted
                        style={{
                          width: "42px",
                          height: "42px",
                          borderRadius: "7px",
                          objectFit: "cover",
                          background: "#000000",
                        }}
                      />
                    ) : (
                      <img
                        src={mediaPreviewUrl}
                        alt="Selected attachment preview"
                        style={{
                          width: "42px",
                          height: "42px",
                          borderRadius: "7px",
                          objectFit: "cover",
                        }}
                      />
                    )}

                    <button
                      type="button"
                      onClick={clearSelectedMedia}
                      disabled={mediaUploading}
                      title="Remove attachment"
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#ff8a9b",
                        cursor: "pointer",
                        fontSize: "18px",
                        padding: "4px",
                      }}
                    >
                      ×
                    </button>
                  </div>
                )}

                <input
                  type="text"
                  value={messageText}
                  onChange={handleMessageInputChange}
                  placeholder="Message..."
                  disabled={sending || mediaUploading}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: "1px solid #30303a",
                    borderRadius: "999px",
                    background: "#17171e",
                    color: "#ffffff",
                    outline: "none",
                    padding: "12px 16px",
                    fontSize: "14px",
                  }}
                />

                <button
                  type="submit"
                  disabled={
                    (!messageText.trim() && !selectedMedia) ||
                    sending ||
                    mediaUploading
                  }
                  style={{
                    border: "none",
                    background: "transparent",
                    color:
                      (!messageText.trim() && !selectedMedia) ||
                      sending ||
                      mediaUploading
                        ? "#555560"
                        : "#a855f7",
                    fontWeight: "800",
                    fontSize: "14px",
                    cursor:
                      (!messageText.trim() && !selectedMedia) ||
                      sending ||
                      mediaUploading
                        ? "default"
                        : "pointer",
                    padding: "10px",
                  }}
                >
                  {mediaUploading
                    ? "Uploading..."
                    : sending
                      ? "Sending..."
                      : "Send"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      {openedMedia?.type === "image" && openedMedia?.url && (
        <div
          onClick={() => setOpenedMedia(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 12000,
            background: "rgba(0,0,0,0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <button
            type="button"
            onClick={() => setOpenedMedia(null)}
            style={{
              position: "absolute",
              top: "20px",
              right: "22px",
              width: "42px",
              height: "42px",
              borderRadius: "50%",
              border: "1px solid #3a3a44",
              background: "#17171e",
              color: "#ffffff",
              fontSize: "24px",
              cursor: "pointer",
            }}
          >
            ×
          </button>

          <img
            src={openedMedia.url}
            alt="ReelVerse message preview"
            onClick={(event) => event.stopPropagation()}
            style={{
              maxWidth: "92vw",
              maxHeight: "82vh",
              objectFit: "contain",
              borderRadius: "12px",
            }}
          />

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              downloadMedia(openedMedia.url, "image");
            }}
            style={{
              position: "absolute",
              bottom: "22px",
              border: "1px solid #3a3a44",
              borderRadius: "999px",
              background: "#17171e",
              color: "#ffffff",
              padding: "10px 16px",
              cursor: "pointer",
              fontWeight: "700",
            }}
          >
            ↓ Download
          </button>
        </div>
      )}

      <style>{`
        .messages-mobile-back {
          display: none;
        }

        /* Fixed-height chat: the name bar and the message box stay on screen,
           only the messages (and the inbox list) scroll, like Instagram. */
        .messages-shell {
          height: calc(100vh - 230px) !important;
          height: calc(100dvh - 230px) !important;
          min-height: 480px !important;
          grid-template-rows: minmax(0, 1fr);
        }

        /* While a chat is open (desktop), hide the big "Messages" heading and
           fit the chat to the screen, so the person's name bar and the message
           box always stay visible and only the messages scroll. */
        @media (min-width: 768px) {
          .rv-page:has(.messages-chat-panel form) {
            min-height: 0 !important;
            padding-top: 12px !important;
            padding-bottom: 16px !important;
          }

          .content:has(.messages-chat-panel form) {
            padding-bottom: 12px !important;
          }

          .rv-page:has(.messages-chat-panel form) > div:first-child {
            display: none !important;
          }

          .rv-page:has(.messages-chat-panel form) .messages-shell {
            height: calc(100vh - 116px) !important;
            height: calc(100dvh - 116px) !important;
            min-height: 420px !important;
          }
        }

        .messages-inbox-panel {
          min-height: 0;
          overflow-y: auto;
        }

        .messages-chat-panel {
          min-height: 0;
          overflow: hidden;
        }

        @media (max-width: 767px) {
          .messages-shell {
            grid-template-columns: 1fr !important;
            height: calc(100vh - 150px) !important;
            height: calc(100dvh - 150px) !important;
            min-height: 0 !important;
            border-radius: 12px !important;
          }

          .messages-inbox-panel {
            border-right: none !important;
          }

          .messages-chat-panel {
            display: none !important;
          }

          .messages-shell:has(.messages-chat-panel form) .messages-inbox-panel {
            display: none;
          }

          .messages-shell:has(.messages-chat-panel form) .messages-chat-panel {
            display: flex !important;
          }

          .messages-mobile-back {
            display: inline-flex !important;
          }
        }
      `}</style>
    </div>
  );
}


// =====================================================
// COMMENTS MODAL
// =====================================================

function CommentsModal({
  video,
  comments,
  loading,
  error,
  authUser,
  onClose,
  onLoginNavigate,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  likedComments,
  commentLikeLoading,
  onToggleCommentLike,
}) {
  const navigate = useNavigate();
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingContent, setEditingContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const startEdit = (comment) => {
    setEditingId(comment.id);
    setEditingContent(comment.content || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingContent("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (editingId !== null) {
      if (!editingContent.trim()) {
        return;
      }

      setSubmitting(true);

      const success = await onUpdateComment(
        editingId,
        editingContent.trim()
      );

      setSubmitting(false);

      if (success) {
        cancelEdit();
      }

      return;
    }

    if (!content.trim()) {
      return;
    }

    setSubmitting(true);

    const success = await onAddComment(
      video.id,
      content.trim()
    );

    setSubmitting(false);

    if (success) {
      setContent("");
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0, 0, 0, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(620px, 95vw)",
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          background: "#111116",
          border: "1px solid #292932",
          borderRadius: "18px",
          overflow: "hidden",
          boxShadow: "0 30px 90px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 20px",
            borderBottom: "1px solid #292932",
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                color: "#ffffff",
                fontSize: "18px",
              }}
            >
              Comments
            </h3>

            <p
              style={{
                margin: "5px 0 0",
                color: "#777783",
                fontSize: "12px",
              }}
            >
              {video.title}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: "36px",
              height: "36px",
              border: "none",
              borderRadius: "50%",
              background: "#24242c",
              color: "#ffffff",
              fontSize: "20px",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "18px 20px",
          }}
        >
          {loading && (
            <div className="feed-message">
              <div className="loading-spinner"></div>
              <p>Loading comments...</p>
            </div>
          )}

          {!loading && error && (
            <div className="feed-message error-message">
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && comments.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "45px 10px",
                color: "#777783",
              }}
            >
              <div
                style={{
                  fontSize: "32px",
                  marginBottom: "10px",
                }}
              >
                💬
              </div>

              <p style={{ margin: 0 }}>
                No comments yet.
              </p>

              <small>
                Be the first to share your thoughts.
              </small>
            </div>
          )}

          {!loading &&
            !error &&
            comments.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                {comments.map((comment) => {
                  const isOwner =
                    Boolean(authUser) &&
                    authUser.username === comment.user;

                  return (
                    <div
                      key={comment.id}
                      style={{
                        padding: "14px",
                        background: "#18181f",
                        border: "1px solid #292932",
                        borderRadius: "12px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          marginBottom: "8px",
                        }}
                      >
                        <div
                          onClick={() => {
                            if (comment.user_id) {
                              onClose();
                              navigate(`/users/${comment.user_id}`);
                            }
                          }}
                          role={comment.user_id ? "button" : undefined}
                          tabIndex={comment.user_id ? 0 : undefined}
                          onKeyDown={(event) => {
                            if (comment.user_id && (event.key === "Enter" || event.key === " ")) {
                              event.preventDefault();
                              onClose();
                              navigate(`/users/${comment.user_id}`);
                            }
                          }}
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "#25252e",
                            color: "#ffffff",
                            fontSize: "13px",
                            fontWeight: "700",
                            overflow: "hidden",
                            flexShrink: 0,
                            cursor: comment.user_id ? "pointer" : "default",
                          }}
                        >
                          {comment.profile_photo_url ? (
                            <img
                              src={comment.profile_photo_url}
                              alt={`${comment.user || "User"} profile`}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                display: "block",
                              }}
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                                const fallback =
                                  event.currentTarget.nextElementSibling;
                                if (fallback) {
                                  fallback.style.display = "flex";
                                }
                              }}
                            />
                          ) : null}

                          <span
                            style={{
                              width: "100%",
                              height: "100%",
                              alignItems: "center",
                              justifyContent: "center",
                              display: comment.profile_photo_url
                                ? "none"
                                : "flex",
                            }}
                          >
                            {(comment.user || "U")
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                        </div>

                        <div style={{ flex: 1 }}>
                          <strong
                            onClick={() => {
                              if (comment.user_id) {
                                onClose();
                                navigate(`/users/${comment.user_id}`);
                              }
                            }}
                            role={comment.user_id ? "button" : undefined}
                            tabIndex={comment.user_id ? 0 : undefined}
                            onKeyDown={(event) => {
                              if (comment.user_id && (event.key === "Enter" || event.key === " ")) {
                                event.preventDefault();
                                onClose();
                                navigate(`/users/${comment.user_id}`);
                              }
                            }}
                            style={{
                              color: "#ffffff",
                              fontSize: "13px",
                              cursor: comment.user_id ? "pointer" : "default",
                            }}
                          >
                            {comment.user || "Unknown"}
                          </strong>

                          <div
                            style={{
                              color: "#666672",
                              fontSize: "11px",
                              marginTop: "2px",
                            }}
                          >
                            {comment.created_at || ""}
                          </div>
                        </div>
                      </div>

                      {editingId === comment.id ? (
                        <div>
                          <textarea
                            value={editingContent}
                            onChange={(event) =>
                              setEditingContent(
                                event.target.value
                              )
                            }
                            rows={3}
                            style={{
                              width: "100%",
                              boxSizing: "border-box",
                              resize: "vertical",
                              padding: "10px",
                              borderRadius: "9px",
                              border: "1px solid #30303a",
                              background: "#111116",
                              color: "#ffffff",
                              outline: "none",
                              font: "inherit",
                            }}
                          />

                          <div
                            style={{
                              display: "flex",
                              gap: "8px",
                              marginTop: "8px",
                            }}
                          >
                            <button
                              type="button"
                              onClick={handleSubmit}
                              disabled={submitting}
                              style={commentSmallButtonStyle}
                            >
                              {submitting
                                ? "Saving..."
                                : "Save"}
                            </button>

                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={submitting}
                              style={
                                commentCancelButtonStyle
                              }
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p
                          style={{
                            margin: 0,
                            color: "#d0d0d7",
                            fontSize: "14px",
                            lineHeight: "1.55",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {comment.content}
                        </p>
                      )}

                      {editingId !== comment.id && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            marginTop: "10px",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              onToggleCommentLike(comment)
                            }
                            disabled={Boolean(
                              commentLikeLoading[comment.id]
                            )}
                            style={{
                              border: "none",
                              background: "transparent",
                              padding: 0,
                              margin: 0,
                              color: likedComments[comment.id]
                                ? "#ff4d6d"
                                : "#888894",
                              cursor: commentLikeLoading[comment.id]
                                ? "wait"
                                : "pointer",
                              font: "inherit",
                              fontSize: "12px",
                              fontWeight: "700",
                            }}
                            title={
                              likedComments[comment.id]
                                ? "Unlike this comment"
                                : "Like this comment"
                            }
                          >
                            {likedComments[comment.id]
                              ? "♥ Liked"
                              : "♡ Like"}{" "}
                            {comment.likes_count || 0}
                          </button>
                        </div>
                      )}

                      {isOwner &&
                        editingId !== comment.id && (
                          <div
                            style={{
                              display: "flex",
                              gap: "12px",
                              marginTop: "10px",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                startEdit(comment)
                              }
                              style={
                                commentTextButtonStyle
                              }
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                onDeleteComment(
                                  comment.id
                                )
                              }
                              style={
                                commentDeleteButtonStyle
                              }
                            >
                              Delete
                            </button>
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        <div
          style={{
            padding: "14px 20px 18px",
            borderTop: "1px solid #292932",
          }}
        >
          {authUser ? (
            <form onSubmit={handleSubmit}>
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "flex-end",
                }}
              >
                <textarea
                  value={content}
                  onChange={(event) =>
                    setContent(event.target.value)
                  }
                  placeholder="Write a comment..."
                  rows={2}
                  style={{
                    flex: 1,
                    boxSizing: "border-box",
                    resize: "none",
                    padding: "11px 12px",
                    borderRadius: "10px",
                    border: "1px solid #30303a",
                    background: "#18181f",
                    color: "#ffffff",
                    outline: "none",
                    font: "inherit",
                  }}
                />

                <button
                  type="submit"
                  disabled={
                    submitting || !content.trim()
                  }
                  style={{
                    border: "none",
                    borderRadius: "10px",
                    padding: "11px 16px",
                    background:
                      "linear-gradient(135deg, #7c3aed, #a855f7)",
                    color: "#ffffff",
                    fontWeight: "700",
                    cursor:
                      submitting || !content.trim()
                        ? "not-allowed"
                        : "pointer",
                    opacity:
                      submitting || !content.trim()
                        ? 0.55
                        : 1,
                  }}
                >
                  {submitting ? "Posting..." : "Post"}
                </button>
              </div>
            </form>
          ) : (
            <div
              style={{
                textAlign: "center",
                color: "#888894",
                fontSize: "13px",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLoginNavigate();
                }}
                style={authLinkButtonStyle}
              >
                Login
              </button>{" "}
              to write a comment.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


const commentSmallButtonStyle = {
  border: "none",
  borderRadius: "8px",
  padding: "7px 11px",
  background: "#7c3aed",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: "600",
};

const commentCancelButtonStyle = {
  border: "1px solid #30303a",
  borderRadius: "8px",
  padding: "7px 11px",
  background: "transparent",
  color: "#cfcfd7",
  cursor: "pointer",
  fontSize: "12px",
};

const commentTextButtonStyle = {
  border: "none",
  background: "transparent",
  color: "#a855f7",
  padding: 0,
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: "600",
};

const commentDeleteButtonStyle = {
  border: "none",
  background: "transparent",
  color: "#ff6b81",
  padding: 0,
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: "600",
};


// =====================================================
// LOGIN PAGE
// =====================================================

function LoginPage({ onLogin }) {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [passwordResetStep, setPasswordResetStep] = useState("email");
  const [passwordResetCode, setPasswordResetCode] = useState("");
  const [newResetPassword, setNewResetPassword] = useState("");
  const [confirmResetPassword, setConfirmResetPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleForgotPasswordSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const cleanRecoveryEmail = recoveryEmail.trim().toLowerCase();

    if (!cleanRecoveryEmail) {
      setError("Please enter your registered email address.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        "/api/auth/forgot-password/send-code",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: cleanRecoveryEmail,
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to send password reset code."
        );
      }

      setRecoveryEmail(cleanRecoveryEmail);
      setPasswordResetCode("");
      setPasswordResetStep("code");
    } catch (err) {
      console.error("Forgot password request failed:", err);
      setError(
        err.message ||
          "Unable to send password reset code."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPasswordCodeVerify = async (event) => {
    event.preventDefault();
    setError("");

    const cleanRecoveryEmail = recoveryEmail.trim().toLowerCase();
    const cleanCode = passwordResetCode.trim();

    if (!cleanCode) {
      setError("Please enter the 6-digit verification code.");
      return;
    }

    if (!/^\d{6}$/.test(cleanCode)) {
      setError("Verification code must be 6 digits.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        "/api/auth/forgot-password/verify-code",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: cleanRecoveryEmail,
            code: cleanCode,
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to verify password reset code."
        );
      }

      setNewResetPassword("");
      setConfirmResetPassword("");
      setPasswordResetStep("password");
    } catch (err) {
      console.error("Password reset code verification failed:", err);
      setError(
        err.message ||
          "Unable to verify password reset code."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleNewResetPasswordSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!newResetPassword) {
      setError("Please enter your new password.");
      return;
    }

    if (!confirmResetPassword) {
      setError("Please confirm your new password.");
      return;
    }

    if (newResetPassword !== confirmResetPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (newResetPassword.length < 12) {
      setError("Password must be at least 12 characters long.");
      return;
    }

    if (newResetPassword.length > 128) {
      setError("Password must not exceed 128 characters.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        "/api/auth/forgot-password/reset-password",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: recoveryEmail.trim().toLowerCase(),
            password: newResetPassword,
            confirm_password: confirmResetPassword,
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to reset password."
        );
      }

      setForgotPasswordMode(false);
      setRecoveryEmail("");
      setPasswordResetStep("email");
      setPasswordResetCode("");
      setNewResetPassword("");
      setConfirmResetPassword("");
      setEmail("");
      setPassword("");
      setError("");

      window.alert(
        data.message ||
          "Password reset successfully. Please login with your new password."
      );
    } catch (err) {
      console.error("Password reset failed:", err);
      setError(
        err.message ||
          "Unable to reset password."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError(
        "Please enter your username or email and password."
      );
      return;
    }

    try {
      setLoading(true);

      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          login: email.trim(),
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Login failed."
        );
      }

      localStorage.setItem(
        "access_token",
        data.access_token
      );

      localStorage.setItem(
        "user",
        JSON.stringify(data.user)
      );

      onLogin(data.user);
      navigate("/");
    } catch (err) {
      console.error("Login failed:", err);
      setError(
        err.message || "Unable to login."
      );
    } finally {
      setLoading(false);
    }
  };

  if (forgotPasswordMode) {
    return (
      <div
        className="auth-stage"
        style={{
          minHeight: "75vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "50px 20px",
        }}
      >
        <div
          style={{
            width: "min(430px, 100%)",
            background: "#111116",
            border: "1px solid #292932",
            borderRadius: "18px",
            padding: "34px",
            boxShadow: "0 25px 70px rgba(0,0,0,0.35)",
          }}
        >
          {passwordResetStep === "email" ? (
            <>
              <div style={{ marginBottom: "26px" }}>
                <span className="hero-label">✦ REELVERSE</span>
                <h2 style={{ margin: "14px 0 8px", color: "#ffffff", fontSize: "34px" }}>
                  Forgot password?
                </h2>
                <p style={{ margin: 0, color: "#888894", lineHeight: "1.6", fontSize: "14px" }}>
                  Enter the email address registered with your ReelVerse account.
                  We&apos;ll send you a verification code to reset your password.
                </p>
              </div>

              <form onSubmit={handleForgotPasswordSubmit}>
                <label style={authLabelStyle}>Registered email</label>
                <input
                  type="email"
                  value={recoveryEmail}
                  onChange={(event) => {
                    setRecoveryEmail(event.target.value);
                    if (error) setError("");
                  }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  style={authInputStyle}
                  autoFocus
                />

                {error && (
                  <div style={{
                    marginTop: "14px", padding: "11px 13px", borderRadius: "10px",
                    background: "rgba(239,68,68,0.10)",
                    border: "1px solid rgba(239,68,68,0.30)",
                    color: "#fca5a5", fontSize: "13px", lineHeight: "1.5",
                  }}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading}
                  style={{ ...authPrimaryButtonStyle, marginTop: "20px" }}>
                  {loading ? "Sending code..." : "Send verification code"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setForgotPasswordMode(false);
                    setPasswordResetStep("email");
                    setPasswordResetCode("");
                    setError("");
                  }}
                  style={{
                    width: "100%", marginTop: "12px", border: "none",
                    background: "transparent", color: "#a78bfa", cursor: "pointer",
                    fontSize: "13px", fontWeight: "700",
                  }}
                >
                  ← Back to login
                </button>
              </form>
            </>
          ) : passwordResetStep === "code" ? (
            <>
              <div style={{ marginBottom: "26px" }}>
                <span className="hero-label">✦ REELVERSE</span>
                <h2 style={{ margin: "14px 0 8px", color: "#ffffff", fontSize: "34px" }}>
                  Verify reset code
                </h2>
                <p style={{ margin: 0, color: "#888894", lineHeight: "1.6", fontSize: "14px" }}>
                  Enter the 6-digit verification code sent to{" "}
                  <strong style={{ color: "#d8d8e2" }}>{recoveryEmail}</strong>.
                </p>
              </div>

              <form onSubmit={handleForgotPasswordCodeVerify}>
                <label style={authLabelStyle}>Verification code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={passwordResetCode}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                    setPasswordResetCode(digits);
                    if (error) setError("");
                  }}
                  placeholder="Enter 6-digit code"
                  autoComplete="one-time-code"
                  maxLength={6}
                  style={{
                    ...authInputStyle,
                    letterSpacing: "5px",
                    textAlign: "center",
                    fontSize: "20px",
                    fontWeight: "800",
                  }}
                  autoFocus
                />

                {error && (
                  <div style={{
                    marginTop: "14px", padding: "11px 13px", borderRadius: "10px",
                    background: "rgba(239,68,68,0.10)",
                    border: "1px solid rgba(239,68,68,0.30)",
                    color: "#fca5a5", fontSize: "13px", lineHeight: "1.5",
                  }}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading}
                  style={{ ...authPrimaryButtonStyle, marginTop: "20px" }}>
                  {loading ? "Verifying..." : "Verify code"}
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setPasswordResetStep("email");
                    setPasswordResetCode("");
                    setError("");
                  }}
                  style={{
                    width: "100%", marginTop: "12px", border: "none",
                    background: "transparent", color: "#a78bfa",
                    cursor: loading ? "wait" : "pointer",
                    fontSize: "13px", fontWeight: "700",
                  }}
                >
                  ← Change email / resend code
                </button>
              </form>
            </>
          ) : (
            <>
              <div style={{ marginBottom: "26px" }}>
                <span className="hero-label">✦ REELVERSE</span>
                <h2
                  style={{
                    margin: "14px 0 8px",
                    color: "#ffffff",
                    fontSize: "34px",
                  }}
                >
                  Create new password
                </h2>
                <p
                  style={{
                    margin: 0,
                    color: "#888894",
                    lineHeight: "1.6",
                    fontSize: "14px",
                  }}
                >
                  Choose a new password for{" "}
                  <strong style={{ color: "#d8d8e2" }}>
                    {recoveryEmail}
                  </strong>.
                </p>
              </div>

              <form onSubmit={handleNewResetPasswordSubmit}>
                <label style={authLabelStyle}>
                  New password
                </label>

                <input
                  type="password"
                  value={newResetPassword}
                  onChange={(event) => {
                    setNewResetPassword(event.target.value);
                    if (error) setError("");
                  }}
                  placeholder="Enter new password"
                  autoComplete="new-password"
                  style={authInputStyle}
                  autoFocus
                />

                <label style={authLabelStyle}>
                  Confirm new password
                </label>

                <input
                  type="password"
                  value={confirmResetPassword}
                  onChange={(event) => {
                    setConfirmResetPassword(event.target.value);
                    if (error) setError("");
                  }}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  style={authInputStyle}
                />

                <p
                  style={{
                    margin: "10px 0 0",
                    color: "#777783",
                    fontSize: "12px",
                    lineHeight: "1.5",
                  }}
                >
                  Use at least 12 characters. Avoid using only letters,
                  only numbers, or a common password.
                </p>

                {error && (
                  <div
                    style={{
                      marginTop: "14px",
                      padding: "11px 13px",
                      borderRadius: "10px",
                      background: "rgba(239,68,68,0.10)",
                      border: "1px solid rgba(239,68,68,0.30)",
                      color: "#fca5a5",
                      fontSize: "13px",
                      lineHeight: "1.5",
                    }}
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    ...authPrimaryButtonStyle,
                    marginTop: "20px",
                  }}
                >
                  {loading
                    ? "Resetting password..."
                    : "Reset password"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPasswordResetStep("code");
                    setNewResetPassword("");
                    setConfirmResetPassword("");
                    setError("");
                  }}
                  style={{
                    width: "100%",
                    marginTop: "12px",
                    border: "none",
                    background: "transparent",
                    color: "#a78bfa",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: "700",
                  }}
                >
                  ← Back to verification code
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="auth-stage"
      style={{
        minHeight: "75vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "50px 20px",
      }}
    >
      <div
        style={{
          width: "min(430px, 100%)",
          background: "#111116",
          border: "1px solid #292932",
          borderRadius: "18px",
          padding: "34px",
          boxShadow:
            "0 25px 70px rgba(0,0,0,0.35)",
        }}
      >
        <span className="hero-label">
          ✦ WELCOME BACK
        </span>

        <h2
          style={{
            margin: "16px 0 8px",
            color: "#ffffff",
            fontSize: "34px",
          }}
        >
          Login to ReelVerse
        </h2>

        <p
          style={{
            color: "#888894",
            marginBottom: "28px",
          }}
        >
          Sign in to like, bookmark, follow creators and more.
        </p>

        <form onSubmit={handleSubmit}>
          <label style={authLabelStyle}>
            Username or email
          </label>

          <input
            type="text"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            placeholder="Username or email address"
            autoComplete="username"
            style={authInputStyle}
          />

          <label style={authLabelStyle}>
            Password
          </label>

          <input
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            placeholder="Enter your password"
            style={authInputStyle}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: "-4px",
              marginBottom: "14px",
            }}
          >
            <button
              type="button"
              onClick={() => {
                setRecoveryEmail("");
                setPasswordResetStep("email");
                setPasswordResetCode("");
                setNewResetPassword("");
                setConfirmResetPassword("");
                setError("");
                setForgotPasswordMode(true);
              }}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                color: "#a78bfa",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: "700",
              }}
            >
              Forgot password?
            </button>
          </div>

          {error && (
            <p style={authErrorStyle}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={authPrimaryButtonStyle}
          >
            {loading
              ? "Logging in..."
              : "Login"}
          </button>
        </form>

        <p style={authFooterStyle}>
          Don't have an account?{" "}
          <button
            type="button"
            onClick={() =>
              navigate("/register")
            }
            style={authLinkButtonStyle}
          >
            Create one
          </button>
        </p>
      </div>
    </div>
  );
}


// =====================================================
// REGISTER PAGE - AUTH-6B EMAIL CODE VERIFICATION
// =====================================================

function RegisterPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [step, setStep] = useState("email");

  // AUTH-6C: Personal information
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  // AUTH-6D: Username
  const [username, setUsername] = useState("");

  // AUTH-6G: Password setup
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [suggestingPassword, setSuggestingPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const cleanEmail = email.trim().toLowerCase();

  const handleSendCode = async (event) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!cleanEmail) {
      setError("Please enter your email address.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        "/api/auth/send-verification-code",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: cleanEmail,
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to send verification code."
        );
      }

      setVerificationCode("");
      setStep("verify");
      setSuccess(
        "Verification code sent! Check your email."
      );
    } catch (err) {
      console.error(
        "Send verification code failed:",
        err
      );

      setError(
        err.message ||
          "Unable to send verification code."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (event) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    const cleanCode = verificationCode.trim();

    if (!/^\d{6}$/.test(cleanCode)) {
      setError("Please enter the 6-digit verification code.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        "/api/auth/verify-email-code",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: cleanEmail,
            code: cleanCode,
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to verify email."
        );
      }

      setStep("personal");
      setSuccess(
        data.message ||
          "Email verified successfully."
      );
    } catch (err) {
      console.error(
        "Email verification failed:",
        err
      );

      setError(
        err.message ||
          "Unable to verify email."
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePersonalInfo = (event) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();

    if (!cleanFirstName) {
      setError("Please enter your first name.");
      return;
    }

    if (!cleanLastName) {
      setError("Please enter your last name.");
      return;
    }

    if (!dateOfBirth) {
      setError("Please enter your date of birth.");
      return;
    }

    const selectedDate = new Date(`${dateOfBirth}T00:00:00`);
    const today = new Date();

    today.setHours(0, 0, 0, 0);

    if (
      Number.isNaN(selectedDate.getTime()) ||
      selectedDate > today
    ) {
      setError("Date of birth cannot be in the future.");
      return;
    }

    setStep("username");
    setSuccess("");
  };

  const handleUsername = async (event) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    const cleanUsername = username.trim();

    if (!cleanUsername) {
      setError("Please choose a username.");
      return;
    }

    if (cleanUsername.length < 3) {
      setError("Username must be at least 3 characters long.");
      return;
    }

    if (cleanUsername.length > 80) {
      setError("Username must not exceed 80 characters.");
      return;
    }

    if (!/^[A-Za-z0-9._]+$/.test(cleanUsername)) {
      setError(
        "Username can only contain letters, numbers, periods, and underscores."
      );
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        `/api/auth/check-username?username=${encodeURIComponent(cleanUsername)}`
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to check username availability."
        );
      }

      setUsername(cleanUsername);

      if (!data.available) {
        setError(data.message || "Username is already taken.");
        return;
      }

      setSuccess("");
      setStep("password");
    } catch (err) {
      console.error("Username availability check failed:", err);
      setError(
        err.message ||
          "Unable to check username availability."
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSetup = async (event) => {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!password) {
      setError("Please enter a password.");
      return;
    }

    if (password.length < 12) {
      setError("Password must be at least 12 characters long.");
      return;
    }

    if (password.length > 128) {
      setError("Password must not exceed 128 characters.");
      return;
    }

    if (!confirmPassword) {
      setError("Please confirm your password.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Password and confirm password do not match.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: cleanEmail,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          date_of_birth: dateOfBirth,
          username: username.trim(),
          password,
          confirm_password: confirmPassword,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || data.msg || "Unable to create account."
        );
      }

      // AUTH-6I: account created successfully.
      // Move straight to the login screen with no intermediate success delay.
      navigate("/login", { replace: true });
    } catch (err) {
      console.error("Registration failed:", err);
      setError(err.message || "Unable to create account.");
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestPassword = async () => {
    setError("");
    setSuccess("");

    try {
      setSuggestingPassword(true);

      const response = await fetch("/api/auth/suggest-password");
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to suggest a strong password."
        );
      }

      const suggestedPassword =
        data.password || data.suggested_password || "";

      if (!suggestedPassword) {
        throw new Error("Unable to suggest a strong password.");
      }

      setPassword(suggestedPassword);
      setConfirmPassword(suggestedPassword);
      setSuccess("Strong password suggested. Save it somewhere secure.");
    } catch (err) {
      console.error("Suggest password failed:", err);
      setError(
        err.message ||
          "Unable to suggest a strong password."
      );
    } finally {
      setSuggestingPassword(false);
    }
  };

  const handleBackToUsername = () => {
    setStep("username");
    setError("");
    setSuccess("");
  };

  const handleBackToPersonalInfo = () => {
    setStep("personal");
    setError("");
    setSuccess("");
  };

  const handleChangeEmail = () => {
    setStep("email");
    setVerificationCode("");
    setFirstName("");
    setLastName("");
    setDateOfBirth("");
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setError("");
    setSuccess("");
  };

  const todayDate = new Date().toISOString().split("T")[0];

  return (
    <div
      className="auth-stage"
      style={{
        minHeight: "75vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "50px 20px",
      }}
    >
      <div
        style={{
          width: "min(430px, 100%)",
          background: "#111116",
          border: "1px solid #292932",
          borderRadius: "18px",
          padding: "34px",
          boxShadow:
            "0 25px 70px rgba(0,0,0,0.35)",
        }}
      >
        <span className="hero-label">
          ✦ JOIN REELVERSE
        </span>

        <h2
          style={{
            margin: "16px 0 8px",
            color: "#ffffff",
            fontSize: "34px",
          }}
        >
          {step === "email"
            ? "Create your account"
            : step === "verify"
              ? "Verify your email"
              : step === "personal"
                ? "Tell us about you"
                : step === "username"
                  ? "Choose your username"
                  : "Create a password"}
        </h2>

        {step === "email" && (
          <>
            <p
              style={{
                color: "#888894",
                marginBottom: "28px",
                lineHeight: "1.6",
              }}
            >
              Start with your email address. We’ll send you a 6-digit verification code.
            </p>

            <form onSubmit={handleSendCode}>
              <label style={authLabelStyle}>
                Email address
              </label>

              <input
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                placeholder="you@example.com"
                autoComplete="email"
                required
                style={authInputStyle}
              />

              {error && (
                <p style={authErrorStyle}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  ...authPrimaryButtonStyle,
                  opacity: loading ? 0.7 : 1,
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                {loading
                  ? "Sending code..."
                  : "Continue"}
              </button>
            </form>
          </>
        )}

        {step === "verify" && (
          <>
            <p
              style={{
                color: "#888894",
                marginBottom: "10px",
                lineHeight: "1.6",
              }}
            >
              Enter the 6-digit verification code sent to:
            </p>

            <p
              style={{
                color: "#ffffff",
                margin: "0 0 22px",
                fontSize: "14px",
                fontWeight: "700",
                overflowWrap: "anywhere",
              }}
            >
              {cleanEmail}
            </p>

            <form onSubmit={handleVerifyCode}>
              <label style={authLabelStyle}>
                Verification code
              </label>

              <input
                type="text"
                value={verificationCode}
                onChange={(event) => {
                  const digits = event.target.value
                    .replace(/\D/g, "")
                    .slice(0, 6);

                  setVerificationCode(digits);
                  setError("");
                }}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                required
                style={{
                  ...authInputStyle,
                  textAlign: "center",
                  letterSpacing: "8px",
                  fontSize: "20px",
                  fontWeight: "700",
                }}
              />

              {success && (
                <p style={authSuccessStyle}>
                  {success}
                </p>
              )}

              {error && (
                <p style={authErrorStyle}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  ...authPrimaryButtonStyle,
                  opacity: loading ? 0.7 : 1,
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                {loading
                  ? "Verifying..."
                  : "Verify email"}
              </button>
            </form>

            <button
              type="button"
              onClick={handleChangeEmail}
              disabled={loading}
              style={{
                ...authLinkButtonStyle,
                display: "block",
                margin: "18px auto 0",
              }}
            >
              Change email address
            </button>
          </>
        )}

        {step === "personal" && (
          <>
            <p
              style={{
                color: "#888894",
                marginBottom: "22px",
                lineHeight: "1.6",
              }}
            >
              Your email is verified. Add your personal information to continue setting up your account.
            </p>

            <form onSubmit={handlePersonalInfo}>
              <label style={authLabelStyle}>
                First name
              </label>

              <input
                type="text"
                value={firstName}
                onChange={(event) => {
                  setFirstName(event.target.value);
                  setError("");
                  setSuccess("");
                }}
                placeholder="First name"
                autoComplete="given-name"
                maxLength={80}
                autoFocus
                required
                style={authInputStyle}
              />

              <label style={authLabelStyle}>
                Last name
              </label>

              <input
                type="text"
                value={lastName}
                onChange={(event) => {
                  setLastName(event.target.value);
                  setError("");
                  setSuccess("");
                }}
                placeholder="Last name"
                autoComplete="family-name"
                maxLength={80}
                required
                style={authInputStyle}
              />

              <label style={authLabelStyle}>
                Date of birth
              </label>

              <input
                type="date"
                value={dateOfBirth}
                onChange={(event) => {
                  setDateOfBirth(event.target.value);
                  setError("");
                  setSuccess("");
                }}
                max={todayDate}
                autoComplete="bday"
                required
                style={authInputStyle}
              />

              {error && (
                <p style={authErrorStyle}>
                  {error}
                </p>
              )}

              {success && (
                <p style={authSuccessStyle}>
                  {success}
                </p>
              )}

              <button
                type="submit"
                style={authPrimaryButtonStyle}
              >
                Continue
              </button>
            </form>

            <button
              type="button"
              onClick={handleChangeEmail}
              style={{
                ...authLinkButtonStyle,
                display: "block",
                margin: "18px auto 0",
              }}
            >
              Use a different email
            </button>
          </>
        )}

        {step === "username" && (
          <>
            <p
              style={{
                color: "#888894",
                marginBottom: "22px",
                lineHeight: "1.6",
              }}
            >
              Choose a username for your ReelVerse account. This is how other users will recognize you.
            </p>

            <form onSubmit={handleUsername}>
              <label style={authLabelStyle}>
                Username
              </label>

              <input
                type="text"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setError("");
                  setSuccess("");
                }}
                placeholder="your_username"
                autoComplete="username"
                maxLength={80}
                autoFocus
                required
                style={authInputStyle}
              />

              <p
                style={{
                  margin: "-7px 0 14px",
                  color: "#777783",
                  fontSize: "12px",
                  lineHeight: "1.5",
                }}
              >
                Use letters, numbers, periods, or underscores.
              </p>

              {error && (
                <p style={authErrorStyle}>
                  {error}
                </p>
              )}

              {success && (
                <p style={authSuccessStyle}>
                  {success}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  ...authPrimaryButtonStyle,
                  opacity: loading ? 0.7 : 1,
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                {loading ? "Checking..." : "Continue"}
              </button>
            </form>

            <button
              type="button"
              onClick={handleBackToPersonalInfo}
              style={{
                ...authLinkButtonStyle,
                display: "block",
                margin: "18px auto 0",
              }}
            >
              Back to personal information
            </button>
          </>
        )}

        {step === "password" && (
          <>
            <p
              style={{
                color: "#888894",
                marginBottom: "22px",
                lineHeight: "1.6",
              }}
            >
              Create a strong password for your ReelVerse account. Use at least 12 characters.
            </p>

            <form onSubmit={handlePasswordSetup}>
              <label style={authLabelStyle}>
                Password
              </label>

              <input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                  setSuccess("");
                }}
                placeholder="Create a strong password"
                autoComplete="new-password"
                maxLength={128}
                autoFocus
                required
                style={authInputStyle}
              />

              <label style={authLabelStyle}>
                Confirm password
              </label>

              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setError("");
                  setSuccess("");
                }}
                placeholder="Enter the password again"
                autoComplete="new-password"
                maxLength={128}
                required
                style={authInputStyle}
              />

              <button
                type="button"
                onClick={handleSuggestPassword}
                disabled={suggestingPassword}
                style={{
                  ...authLinkButtonStyle,
                  display: "block",
                  margin: "14px 0 0",
                  opacity: suggestingPassword ? 0.7 : 1,
                  cursor: suggestingPassword ? "wait" : "pointer",
                }}
              >
                {suggestingPassword
                  ? "Generating..."
                  : "Suggest strong password"}
              </button>

              {error && (
                <p style={authErrorStyle}>
                  {error}
                </p>
              )}

              {success && (
                <p style={authSuccessStyle}>
                  {success}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  ...authPrimaryButtonStyle,
                  opacity: loading ? 0.7 : 1,
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                {loading ? "Creating account..." : "Create account"}
              </button>
            </form>

            <button
              type="button"
              onClick={handleBackToUsername}
              style={{
                ...authLinkButtonStyle,
                display: "block",
                margin: "18px auto 0",
              }}
            >
              Back to username
            </button>
          </>
        )}

        <p style={authFooterStyle}>
          Already have an account?{" "}
          <button
            type="button"
            onClick={() =>
              navigate("/login")
            }
            style={authLinkButtonStyle}
          >
            Login
          </button>
        </p>
      </div>
    </div>
  );
}


// =====================================================
// AUTH STYLES
// =====================================================

const profileLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "7px 10px",
  border: "1px solid #343440",
  borderRadius: "9px",
  background: "#111116",
  color: "#c4a7ff",
  fontSize: "12px",
  fontWeight: "700",
  textDecoration: "none",
};

const authLabelStyle = {
  display: "block",
  color: "#d8d8df",
  fontSize: "13px",
  marginBottom: "8px",
  marginTop: "16px",
};

const authInputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "13px 14px",
  borderRadius: "6px",
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.07)",
  color: "#ffffff",
  outline: "none",
  fontSize: "15px",
};

const authPrimaryButtonStyle = {
  width: "100%",
  marginTop: "22px",
  padding: "13px 16px",
  border: "none",
  borderRadius: "6px",
  background:
    "linear-gradient(135deg, #7c3aed, #a855f7)",
  color: "#ffffff",
  fontWeight: "700",
  cursor: "pointer",
};

const authErrorStyle = {
  color: "#ff6b81",
  fontSize: "13px",
  marginTop: "14px",
};

const authSuccessStyle = {
  color: "#68d391",
  fontSize: "13px",
  marginTop: "14px",
};

const authFooterStyle = {
  marginTop: "22px",
  textAlign: "center",
  color: "#888894",
  fontSize: "13px",
};

const authLinkButtonStyle = {
  border: "none",
  background: "transparent",
  color: "#a855f7",
  padding: 0,
  cursor: "pointer",
  font: "inherit",
  fontWeight: "600",
};


// =====================================================
// MAIN APPLICATION
// =====================================================

function ReelVerseApp() {
  const routeLocation = useLocation();
  const isAuthRoute =
    routeLocation.pathname === "/login" ||
    routeLocation.pathname === "/register";

  const [videos, setVideos] = useState([]);

  // A video deleted from any card is removed from the shared list.
  useEffect(() => {
    const handleVideoDeleted = (event) => {
      const deletedId = event.detail && event.detail.id;

      setVideos((currentVideos) =>
        currentVideos.filter((item) => item.id !== deletedId)
      );
    };

    window.addEventListener("reelverse:video-deleted", handleVideoDeleted);

    return () => {
      window.removeEventListener(
        "reelverse:video-deleted",
        handleVideoDeleted
      );
    };
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedVideo, setSelectedVideo] = useState(null);

  // Share links: /?v=<video id>
  const sharedVideoId = new URLSearchParams(routeLocation.search).get("v");
  const openedSharedVideoRef = useRef(null);
  const [shareToast, setShareToast] = useState("");
  const shareToastTimerRef = useRef(null);

  // Videos liked by the current logged-in user
  const [likedVideos, setLikedVideos] = useState({});

  // Prevents duplicate like/unlike requests
  const [likeLoading, setLikeLoading] = useState({});

  // Currently opened comments panel
  const [commentVideo, setCommentVideo] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] =
    useState(false);
  const [commentsError, setCommentsError] =
    useState("");

  // Number of comments for each video
  const [commentsCount, setCommentsCount] =
    useState({});

  // Comments liked by the current logged-in user
  const [likedComments, setLikedComments] =
    useState({});

  // Prevents duplicate comment like/unlike requests
  const [commentLikeLoading, setCommentLikeLoading] =
    useState({});

  // Videos bookmarked by the current logged-in user
  const [bookmarkedVideos, setBookmarkedVideos] =
    useState({});

  // Prevents duplicate bookmark requests
  const [bookmarkLoading, setBookmarkLoading] =
    useState({});

  // Current user's watch history
  const [historyVideos, setHistoryVideos] =
    useState([]);
  const [historyLoading, setHistoryLoading] =
    useState(false);
  const [historyError, setHistoryError] =
    useState("");

  // Currently logged-in user
  const [authUser, setAuthUser] = useState(() => {
    try {
      const savedUser =
        localStorage.getItem("user");

      return savedUser
        ? JSON.parse(savedUser)
        : null;
    } catch {
      return null;
    }
  });

  const navigate = useNavigate();

  // ===================================================
  // NAVBAR SEARCH - HISTORY + DYNAMIC RECOMMENDATIONS
  // ===================================================
  const [navbarSearchText, setNavbarSearchText] = useState("");
  const [navbarSearchFocused, setNavbarSearchFocused] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [navbarSearchHistory, setNavbarSearchHistory] = useState([]);
  const [navbarSearchSuggestions, setNavbarSearchSuggestions] = useState([]);
  const [navbarSearchLoading, setNavbarSearchLoading] = useState(false);
  const [navbarSearchClearing, setNavbarSearchClearing] = useState(false);

  const navbarSearchToken = localStorage.getItem("access_token");

  const loadNavbarSearchHistory = async () => {
    if (!authUser || !navbarSearchToken) {
      setNavbarSearchHistory([]);
      return;
    }

    try {
      const response = await fetch("/api/search-history", {
        headers: {
          Authorization: `Bearer ${navbarSearchToken}`,
        },
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || data.msg || "Unable to load search history.");
      }

      setNavbarSearchHistory(
        Array.isArray(data.history) ? data.history.slice(0, 5) : []
      );
    } catch (err) {
      console.error("Search history request failed:", err);
      setNavbarSearchHistory([]);
    }
  };

  useEffect(() => {
    loadNavbarSearchHistory();
  }, [authUser?.id]);

  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(async () => {
      try {
        setNavbarSearchLoading(true);
        const keyword = navbarSearchText.trim();
        const endpoint = keyword
          ? `/api/videos/search-suggestions?q=${encodeURIComponent(keyword)}`
          : "/api/videos/search-suggestions";

        const response = await fetch(endpoint);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.message || data.msg || "Unable to load search suggestions.");
        }

        if (!cancelled) {
          setNavbarSearchSuggestions(
            Array.isArray(data.suggestions) ? data.suggestions.slice(0, 5) : []
          );
        }
      } catch (err) {
        console.error("Search suggestions request failed:", err);
        if (!cancelled) {
          setNavbarSearchSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setNavbarSearchLoading(false);
        }
      }
    }, navbarSearchText.trim() ? 180 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [navbarSearchText]);

  const saveNavbarSearchHistory = async (value) => {
    const query = value.trim();

    if (!query || !authUser || !navbarSearchToken) {
      return;
    }

    try {
      const response = await fetch("/api/search-history", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${navbarSearchToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || data.msg || "Unable to save search history.");
      }

      setNavbarSearchHistory(
        Array.isArray(data.history) ? data.history.slice(0, 5) : []
      );
    } catch (err) {
      console.error("Save search history failed:", err);
    }
  };

  const performNavbarSearch = async (value) => {
    const query = value.trim();

    if (!query) {
      navigate("/explore");
      return;
    }

    setNavbarSearchText(query);
    await saveNavbarSearchHistory(query);
    setNavbarSearchFocused(false);
    navigate(`/explore?search=${encodeURIComponent(query)}`);
  };

  const clearNavbarSearchHistory = async () => {
    if (!navbarSearchToken || navbarSearchClearing) {
      return;
    }

    try {
      setNavbarSearchClearing(true);
      const response = await fetch("/api/search-history", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${navbarSearchToken}`,
        },
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || data.msg || "Unable to remove search history.");
      }

      setNavbarSearchHistory([]);
    } catch (err) {
      console.error("Clear search history failed:", err);
    } finally {
      setNavbarSearchClearing(false);
    }
  };

  const navbarSearchItems = navbarSearchText.trim()
    ? navbarSearchSuggestions.map((item) => ({
        text: item.text,
        kind: "suggestion",
      }))
    : navbarSearchHistory.length > 0
      ? navbarSearchHistory.slice(0, 5).map((item) => ({
          text: item.query,
          kind: "history",
        }))
      : navbarSearchSuggestions.map((item) => ({
          text: item.text,
          kind: "suggestion",
        }));

  // Restore the logged-in user's liked videos from the database
  useEffect(() => {
    const loadMyLikedVideos = async () => {
      const token = localStorage.getItem("access_token");

      if (!authUser || !token) {
        setLikedVideos({});
        return;
      }

      try {
        const response = await fetch("/api/likes/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          console.error(
            "Could not load liked videos:",
            data.message || data.msg || response.status
          );
          return;
        }

        const likedMap = {};

        (data.liked_video_ids || []).forEach((videoId) => {
          likedMap[videoId] = true;
        });

        setLikedVideos(likedMap);
      } catch (err) {
        console.error("Liked videos request failed:", err);
      }
    };

    loadMyLikedVideos();
  }, [authUser?.id]);

  // STEP 13D: unread notification badge
  const [hasUnreadNotifications, setHasUnreadNotifications] =
    useState(false);

  useEffect(() => {
    const loadUnreadNotificationStatus = async () => {
      const token = localStorage.getItem("access_token");

      if (!authUser || !token) {
        setHasUnreadNotifications(false);
        return;
      }

      try {
        const response = await fetch("/api/notifications", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          return;
        }

        const data = await response.json().catch(() => []);

        setHasUnreadNotifications(
          Array.isArray(data) &&
            data.some((notification) => !notification.is_read)
        );
      } catch (err) {
        console.error(
          "Unread notification status request failed:",
          err
        );
      }
    };

    loadUnreadNotificationStatus();

    const intervalId = window.setInterval(
      loadUnreadNotificationStatus,
      10000
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authUser?.id]);

  // STEP 14C: unread DM indicator for the Messages sidebar item
  const [hasUnreadMessages, setHasUnreadMessages] =
    useState(false);

  useEffect(() => {
    const loadUnreadMessageStatus = async () => {
      const token = localStorage.getItem("access_token");

      if (!authUser || !token) {
        setHasUnreadMessages(false);
        return;
      }

      try {
        const response = await fetch(
          "/api/messages/conversations",
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          return;
        }

        const data = await response.json().catch(() => ({}));
        const conversationData = Array.isArray(data)
          ? data
          : Array.isArray(data.conversations)
            ? data.conversations
            : [];

        setHasUnreadMessages(
          conversationData.some(
            (conversation) =>
              Number(conversation.unread_count || 0) > 0
          )
        );
      } catch (err) {
        console.error(
          "Unread message status request failed:",
          err
        );
      }
    };

    loadUnreadMessageStatus();

    const intervalId = window.setInterval(
      loadUnreadMessageStatus,
      10000
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authUser?.id]);


  // ===================================================
  // FETCH VIDEOS
  // ===================================================

  useEffect(() => {
    const fetchVideos = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          "/api/videos?page=1&per_page=50"
        );

        if (!response.ok) {
          throw new Error(
            `Server returned ${response.status}`
          );
        }

        const data =
          await response.json();

        const videoData = Array.isArray(data)
          ? data
          : data.videos || [];

        setVideos(videoData);

        // The current comments API returns the comments list.
        // We use its length as the comment count for each video.
        const countResults =
          await Promise.all(
            videoData.map(async (video) => {
              try {
                const commentResponse =
                  await fetch(
                    `/api/videos/${video.id}/comments`
                  );

                if (!commentResponse.ok) {
                  return {
                    id: video.id,
                    count: 0,
                  };
                }

                const commentData =
                  await commentResponse.json();

                return {
                  id: video.id,
                  count: Array.isArray(commentData)
                    ? commentData.length
                    : 0,
                };
              } catch (commentErr) {
                console.error(
                  `Could not load comment count for video ${video.id}:`,
                  commentErr
                );

                return {
                  id: video.id,
                  count: 0,
                };
              }
            })
          );

        const countMap = {};

        countResults.forEach((item) => {
          countMap[item.id] =
            item.count;
        });

        setCommentsCount(countMap);
      } catch (err) {
        console.error(
          "Error loading videos:",
          err
        );

        setError(
          "Unable to connect to the ReelVerse backend."
        );
      } finally {
        setLoading(false);
      }
    };

    fetchVideos();
  }, []);


  // ===================================================
  // LOAD MY BOOKMARKS
  // ===================================================

  useEffect(() => {
    const loadBookmarks = async () => {
      const token =
        localStorage.getItem(
          "access_token"
        );

      if (!token) {
        setBookmarkedVideos({});
        return;
      }

      try {
        const response = await fetch(
          "/api/my-bookmarks",
          {
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          setBookmarkedVideos({});
          return;
        }

        const data =
          await response.json();

        const bookmarkMap = {};

        if (Array.isArray(data)) {
          data.forEach((bookmark) => {
            if (
              bookmark.id !== undefined &&
              bookmark.id !== null
            ) {
              bookmarkMap[
                bookmark.id
              ] = true;
            }
          });
        }

        setBookmarkedVideos(
          bookmarkMap
        );
      } catch (err) {
        console.error(
          "Could not load bookmarks:",
          err
        );

        setBookmarkedVideos({});
      }
    };

    loadBookmarks();
  }, [authUser]);


  // ===================================================
  // WATCH HISTORY
  // ===================================================

  const loadHistory = async () => {
    const token =
      localStorage.getItem(
        "access_token"
      );

    if (!token) {
      setHistoryVideos([]);
      setHistoryError("");
      return;
    }

    try {
      setHistoryLoading(true);
      setHistoryError("");

      const response = await fetch(
        "/api/my-history",
        {
          headers: {
            Authorization:
              `Bearer ${token}`,
          },
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to load watch history."
        );
      }

      setHistoryVideos(
        Array.isArray(data)
          ? data
          : []
      );
    } catch (err) {
      console.error(
        "History request failed:",
        err
      );

      setHistoryError(
        err.message ||
          "Unable to load your watch history."
      );

      setHistoryVideos([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [authUser]);


  // ===================================================
  // OPEN VIDEO + ADD VIEW
  // ===================================================

  const openVideo = async (video) => {
    setSelectedVideo(video);

    try {
      const response = await fetch(
        `/api/videos/${video.id}/view`,
        {
          method: "POST",
        }
      );

      if (!response.ok) {
        console.error(
          "Could not update video view."
        );

        return;
      }

      const data =
        await response.json();

      setVideos((currentVideos) =>
        currentVideos.map((item) =>
          item.id === video.id
            ? {
                ...item,
                views: data.views,
              }
            : item
        )
      );

      setSelectedVideo(
        (currentVideo) => {
          if (!currentVideo) {
            return currentVideo;
          }

          return {
            ...currentVideo,
            views: data.views,
          };
        }
      );
    } catch (err) {
      console.error(
        "View request failed:",
        err
      );
    }

    // Add the video to the logged-in user's watch history.
    const token =
      localStorage.getItem(
        "access_token"
      );

    if (token) {
      try {
        const historyResponse =
          await fetch(
            `/api/videos/${video.id}/history`,
            {
              method: "POST",
              headers: {
                Authorization:
                  `Bearer ${token}`,
              },
            }
          );

        if (!historyResponse.ok) {
          const historyData =
            await historyResponse
              .json()
              .catch(() => ({}));

          console.error(
            "Could not update watch history:",
            historyData.message ||
              historyData.msg ||
              historyResponse.status
          );

          return;
        }

        await loadHistory();
      } catch (err) {
        console.error(
          "History update failed:",
          err
        );
      }
    }
  };


  // ===================================================
  // LIKE / UNLIKE VIDEO
  // ===================================================

  const toggleLike = async (video) => {
    const token =
      localStorage.getItem(
        "access_token"
      );

    if (!token) {
      alert(
        "Please login first to like videos."
      );

      return;
    }

    if (likeLoading[video.id]) {
      return;
    }

    const currentlyLiked =
      Boolean(
        likedVideos[video.id]
      );

    setLikeLoading((current) => ({
      ...current,
      [video.id]: true,
    }));

    try {
      const response =
        await fetch(
          `/api/videos/${video.id}/like`,
          {
            method:
              currentlyLiked
                ? "DELETE"
                : "POST",

            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to update like."
        );
      }

      setLikedVideos(
        (current) => ({
          ...current,
          [video.id]:
            !currentlyLiked,
        })
      );

      setVideos(
        (currentVideos) =>
          currentVideos.map(
            (item) =>
              item.id === video.id
                ? {
                    ...item,
                    likes:
                      Math.max(
                        0,
                        (item.likes ||
                          0) +
                          (currentlyLiked
                            ? -1
                            : 1)
                      ),
                  }
                : item
          )
      );

      setHistoryVideos(
        (currentHistory) =>
          currentHistory.map(
            (item) =>
              item.id === video.id
                ? {
                    ...item,
                    likes:
                      Math.max(
                        0,
                        (item.likes ||
                          0) +
                          (currentlyLiked
                            ? -1
                            : 1)
                      ),
                  }
                : item
          )
      );

      setSelectedVideo(
        (currentVideo) => {
          if (
            !currentVideo ||
            currentVideo.id !==
              video.id
          ) {
            return currentVideo;
          }

          return {
            ...currentVideo,
            likes:
              Math.max(
                0,
                (currentVideo.likes ||
                  0) +
                  (currentlyLiked
                    ? -1
                    : 1)
              ),
          };
        }
      );
    } catch (err) {
      console.error(
        "Like request failed:",
        err
      );

      alert(
        err.message ||
          "Unable to update like."
      );
    } finally {
      setLikeLoading(
        (current) => ({
          ...current,
          [video.id]: false,
        })
      );
    }
  };


  // ===================================================
  // BOOKMARK / REMOVE BOOKMARK
  // ===================================================

  const toggleBookmark = async (video) => {
    const token =
      localStorage.getItem(
        "access_token"
      );

    if (!token) {
      alert(
        "Please login first to bookmark videos."
      );

      navigate("/login");

      return;
    }

    if (bookmarkLoading[video.id]) {
      return;
    }

    const currentlyBookmarked =
      Boolean(
        bookmarkedVideos[video.id]
      );

    setBookmarkLoading(
      (current) => ({
        ...current,
        [video.id]: true,
      })
    );

    try {
      const response =
        await fetch(
          `/api/videos/${video.id}/bookmark`,
          {
            method:
              currentlyBookmarked
                ? "DELETE"
                : "POST",

            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to update bookmark."
        );
      }

      setBookmarkedVideos(
        (current) => ({
          ...current,
          [video.id]:
            !currentlyBookmarked,
        })
      );
    } catch (err) {
      console.error(
        "Bookmark request failed:",
        err
      );

      alert(
        err.message ||
          "Unable to update bookmark."
      );
    } finally {
      setBookmarkLoading(
        (current) => ({
          ...current,
          [video.id]: false,
        })
      );
    }
  };


  // ===================================================
  // COMMENTS
  // ===================================================

  const loadComments = async (videoId) => {
    try {
      setCommentsLoading(true);
      setCommentsError("");

      const response =
        await fetch(
          `/api/videos/${videoId}/comments`
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to load comments."
        );
      }

      const commentList =
        Array.isArray(data)
          ? data
          : [];

      setComments(
        commentList
      );

      setCommentsCount(
        (current) => ({
          ...current,
          [videoId]:
            commentList.length,
        })
      );

      return true;
    } catch (err) {
      console.error(
        "Comments request failed:",
        err
      );

      setCommentsError(
        err.message ||
          "Unable to load comments."
      );

      setComments([]);

      return false;
    } finally {
      setCommentsLoading(false);
    }
  };


  const loadLikedComments = async () => {
    const token =
      localStorage.getItem(
        "access_token"
      );

    if (!token) {
      setLikedComments({});
      return;
    }

    try {
      const response =
        await fetch(
          "/api/comments/likes/me",
          {
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to load liked comments."
        );
      }

      const likedMap = {};

      (
        Array.isArray(data.liked_comment_ids)
          ? data.liked_comment_ids
          : []
      ).forEach((commentId) => {
        likedMap[commentId] = true;
      });

      setLikedComments(likedMap);
    } catch (err) {
      console.error(
        "Liked comments request failed:",
        err
      );
      setLikedComments({});
    }
  };


  const toggleCommentLike = async (comment) => {
    if (!comment?.id) {
      return;
    }

    const token =
      localStorage.getItem(
        "access_token"
      );

    if (!token) {
      alert(
        "Please login first to like comments."
      );
      return;
    }

    if (commentLikeLoading[comment.id]) {
      return;
    }

    const alreadyLiked =
      Boolean(
        likedComments[comment.id]
      );

    try {
      setCommentLikeLoading(
        (current) => ({
          ...current,
          [comment.id]: true,
        })
      );

      const response =
        await fetch(
          `/api/comments/${comment.id}/like`,
          {
            method:
              alreadyLiked
                ? "DELETE"
                : "POST",
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to update comment like."
        );
      }

      setLikedComments(
        (current) => ({
          ...current,
          [comment.id]:
            Boolean(data.liked),
        })
      );

      setComments(
        (currentComments) => {
          const updatedComments =
            currentComments.map(
              (currentComment) =>
                Number(currentComment.id) ===
                Number(comment.id)
                  ? {
                      ...currentComment,
                      likes_count:
                        Number(
                          data.likes_count
                        ) || 0,
                    }
                  : currentComment
            );

          return updatedComments.sort(
            (a, b) => {
              const likeDifference =
                (Number(b.likes_count) || 0) -
                (Number(a.likes_count) || 0);

              if (likeDifference !== 0) {
                return likeDifference;
              }

              return (
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime()
              );
            }
          );
        }
      );
    } catch (err) {
      console.error(
        "Comment like failed:",
        err
      );

      alert(
        err.message ||
          "Unable to update comment like."
      );
    } finally {
      setCommentLikeLoading(
        (current) => ({
          ...current,
          [comment.id]: false,
        })
      );
    }
  };


  const openComments = async (video) => {
    setCommentVideo(video);
    setComments([]);
    setCommentsError("");

    await Promise.all([
      loadComments(
        video.id
      ),
      loadLikedComments(),
    ]);
  };


  const closeComments = () => {
    setCommentVideo(null);
    setComments([]);
    setCommentsError("");
  };


  const addComment = async (
    videoId,
    content
  ) => {
    const token =
      localStorage.getItem(
        "access_token"
      );

    if (!token) {
      alert(
        "Please login first to comment."
      );

      return false;
    }

    try {
      const response =
        await fetch(
          `/api/videos/${videoId}/comments`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${token}`,
            },

            body: JSON.stringify({
              content,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to add comment."
        );
      }

      await loadComments(
        videoId
      );

      return true;
    } catch (err) {
      console.error(
        "Add comment failed:",
        err
      );

      alert(
        err.message ||
          "Unable to add comment."
      );

      return false;
    }
  };


  const updateComment = async (
    commentId,
    content
  ) => {
    const token =
      localStorage.getItem(
        "access_token"
      );

    if (!token) {
      alert(
        "Please login first to edit comments."
      );

      return false;
    }

    try {
      const response =
        await fetch(
          `/api/comments/${commentId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${token}`,
            },

            body: JSON.stringify({
              content,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to update comment."
        );
      }

      if (commentVideo) {
        await loadComments(
          commentVideo.id
        );
      }

      return true;
    } catch (err) {
      console.error(
        "Update comment failed:",
        err
      );

      alert(
        err.message ||
          "Unable to update comment."
      );

      return false;
    }
  };


  const deleteComment = async (
    commentId
  ) => {
    const token =
      localStorage.getItem(
        "access_token"
      );

    if (!token) {
      alert(
        "Please login first to delete comments."
      );

      return;
    }

    const confirmed =
      window.confirm(
        "Are you sure you want to delete this comment?"
      );

    if (!confirmed) {
      return;
    }

    try {
      const response =
        await fetch(
          `/api/comments/${commentId}`,
          {
            method: "DELETE",

            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to delete comment."
        );
      }

      if (commentVideo) {
        await loadComments(
          commentVideo.id
        );
      }
    } catch (err) {
      console.error(
        "Delete comment failed:",
        err
      );

      alert(
        err.message ||
          "Unable to delete comment."
      );
    }
  };


  // ===================================================
  // CLEAR WATCH HISTORY
  // ===================================================

  const clearHistory = async () => {
    const token =
      localStorage.getItem(
        "access_token"
      );

    if (!token) {
      alert(
        "Please login first to clear your history."
      );

      navigate("/login");

      return;
    }

    const confirmed =
      window.confirm(
        "Are you sure you want to clear your entire watch history?"
      );

    if (!confirmed) {
      return;
    }

    try {
      const response =
        await fetch(
          "/api/my-history",
          {
            method: "DELETE",

            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            data.msg ||
            "Unable to clear watch history."
        );
      }

      setHistoryVideos([]);
      setHistoryError("");
    } catch (err) {
      console.error(
        "Clear history failed:",
        err
      );

      alert(
        err.message ||
          "Unable to clear watch history."
      );
    }
  };


  // ===================================================
  // LOGIN / LOGOUT
  // ===================================================

  const updateAuthUser = (updatedUser) => {
    if (!updatedUser) {
      return;
    }

    setAuthUser((currentUser) => {
      const nextUser = {
        ...(currentUser || {}),
        ...updatedUser,
      };

      localStorage.setItem(
        "user",
        JSON.stringify(nextUser)
      );

      return nextUser;
    });
  };


  const logout = () => {
    localStorage.removeItem(
      "access_token"
    );

    localStorage.removeItem(
      "user"
    );

    setAuthUser(null);
    setLikedVideos({});
    setBookmarkedVideos({});
    setBookmarkLoading({});
    setHistoryVideos([]);
    setHistoryError("");

    navigate("/");
  };


  // ===================================================
  // CLOSE VIDEO
  // ===================================================

  const closeVideo = () => {
    setSelectedVideo(null);

    // Opened from a shared link? Take the ?v= part out of the address bar.
    if (sharedVideoId) {
      navigate(
        {
          pathname: routeLocation.pathname,
          search: "",
        },
        { replace: true }
      );
    }
  };


  // ===================================================
  // SHARE A VIDEO + OPEN A SHARED LINK
  // ===================================================

  const showShareToast = (message) => {
    setShareToast(message);

    if (shareToastTimerRef.current) {
      clearTimeout(shareToastTimerRef.current);
    }

    shareToastTimerRef.current = setTimeout(() => {
      setShareToast("");
    }, 2600);
  };

  // The link looks like https://your-site/?v=12
  const buildVideoShareLink = (video) =>
    `${window.location.origin}/?v=${video.id}`;

  const copyTextToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Older browsers: fall back to a hidden text box.
      try {
        const box = document.createElement("textarea");
        box.value = text;
        box.style.position = "fixed";
        box.style.opacity = "0";
        document.body.appendChild(box);
        box.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(box);
        return copied;
      } catch {
        return false;
      }
    }
  };

  const shareVideo = async (video) => {
    const link = buildVideoShareLink(video);

    // Phones show their own share sheet (WhatsApp, Instagram, ...).
    if (
      navigator.share &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    ) {
      try {
        await navigator.share({
          title: video.title,
          text: `Watch "${video.title}" by ${video.creator} on ReelVerse`,
          url: link,
        });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") {
          return;
        }
      }
    }

    const copied = await copyTextToClipboard(link);

    showShareToast(
      copied
        ? "Video link copied!"
        : `Copy this link: ${link}`
    );
  };

  // Open the video when someone arrives through a shared link.
  useEffect(() => {
    if (!sharedVideoId) {
      openedSharedVideoRef.current = null;
      return;
    }

    if (openedSharedVideoRef.current === sharedVideoId) {
      return;
    }

    openedSharedVideoRef.current = sharedVideoId;

    const openSharedVideo = async () => {
      try {
        const response = await fetch(`/api/videos/${sharedVideoId}`);

        if (!response.ok) {
          showShareToast("This shared video is not available.");
          navigate(
            { pathname: routeLocation.pathname, search: "" },
            { replace: true }
          );
          return;
        }

        const sharedVideo = await response.json();

        openVideo(sharedVideo);
      } catch {
        showShareToast("Could not open the shared video.");
      }
    };

    openSharedVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedVideoId]);


  // ===================================================
  // NAVIGATION ITEMS
  // ===================================================

  const navigationItems = [
    {
      name: "Home",
      icon: "⌂",
      path: "/",
      end: true,
    },
    {
      name: "Explore",
      icon: "◉",
      path: "/explore",
    },
    {
      name: "Trending",
      icon: "↗",
      path: "/trending",
    },
    {
      name: "Following",
      icon: "♡",
      path: "/following",
    },
    {
      name: "Messages",
      icon: "✉",
      path: "/messages",
    },
    {
      name: "Bookmarks",
      icon: "🔖",
      path: "/bookmarks",
    },
    {
      name: "History",
      icon: "◷",
      path: "/history",
    },
  ];


  // ===================================================
  // RENDER
  // ===================================================

  return (
    <div className={`app ${isAuthRoute ? "auth-mode" : ""}`}>

      {isAuthRoute && <AuthBackdrop />}

      {/* =================================================
          NAVBAR
      ================================================= */}

      <header className={`navbar ${mobileSearchOpen ? "mobile-search-open" : ""}`}>

        <div
          className="logo-section"
          onClick={() =>
            navigate("/")
          }
          style={{
            cursor: "pointer",
          }}
        >
          <div className="logo-mark">
            <ReelVerseMark />
          </div>

          <h1>
            Reel<span className="rv-wm-v">Verse</span>
          </h1>
        </div>


        <div
          className={`search-box ${mobileSearchOpen ? "mobile-search-active" : ""}`}
          style={{
            position: "relative",
            overflow: "visible",
          }}
        >
          <button
            type="button"
            className="search-icon search-icon-button"
            onClick={() => {
              if (window.innerWidth <= 767 && !mobileSearchOpen) {
                setMobileSearchOpen(true);
                setNavbarSearchFocused(true);

                window.setTimeout(() => {
                  document.querySelector(".mobile-search-active input")?.focus();
                }, 0);

                return;
              }

              performNavbarSearch(navbarSearchText);
            }}
            aria-label="Search"
            title="Search"
          >
            ⌕
          </button>

          <input
            type="text"
            placeholder="Search videos, creators..."
            value={navbarSearchText}
            autoComplete="off"
            onFocus={() => setNavbarSearchFocused(true)}
            onChange={(event) => {
              setNavbarSearchText(event.target.value);
              setNavbarSearchFocused(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                performNavbarSearch(navbarSearchText);
              }

              if (event.key === "Escape") {
                setNavbarSearchFocused(false);
              }
            }}
            style={{
              paddingRight: navbarSearchText ? "38px" : undefined,
            }}
          />

          {navbarSearchText && (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setNavbarSearchText("");
                setNavbarSearchFocused(false);
                setMobileSearchOpen(false);
                navigate("/explore");
              }}
              style={{
                position: "absolute",
                right: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                width: "26px",
                height: "26px",
                border: "none",
                borderRadius: "50%",
                background: "transparent",
                color: "#9a9aa6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: "19px",
                lineHeight: 1,
                zIndex: 1001,
              }}
            >
              ×
            </button>
          )}

          {mobileSearchOpen && !navbarSearchText && (
            <button
              type="button"
              className="mobile-search-close"
              aria-label="Close search"
              title="Close search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setNavbarSearchFocused(false);
                setMobileSearchOpen(false);
              }}
            >
              ×
            </button>
          )}

          {navbarSearchFocused && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                left: 0,
                right: 0,
                zIndex: 1000,
                background: "#111116",
                border: "1px solid #2d2d36",
                borderRadius: "12px",
                boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
                overflow: "hidden",
              }}
            >
              {navbarSearchLoading && navbarSearchItems.length === 0 ? (
                <div
                  style={{
                    padding: "13px 15px",
                    color: "#777783",
                    fontSize: "13px",
                  }}
                >
                  Finding suggestions...
                </div>
              ) : navbarSearchItems.length > 0 ? (
                <>
                  {navbarSearchItems.map((item, index) => (
                    <button
                      key={`${item.kind}-${item.text}-${index}`}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => performNavbarSearch(item.text)}
                      style={{
                        width: "100%",
                        border: "none",
                        borderBottom:
                          index < navbarSearchItems.length - 1
                            ? "1px solid #202027"
                            : "none",
                        background: "#111116",
                        color: "#ffffff",
                        display: "flex",
                        alignItems: "center",
                        gap: "11px",
                        padding: "12px 15px",
                        textAlign: "left",
                        cursor: "pointer",
                        fontSize: "13px",
                      }}
                    >
                      <span
                        style={{
                          width: "18px",
                          flexShrink: 0,
                          color: item.kind === "history" ? "#a78bfa" : "#888894",
                          fontSize: "16px",
                        }}
                      >
                        {item.kind === "history" ? "↶" : "⌕"}
                      </span>

                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.text}
                      </span>
                    </button>
                  ))}

                  {!navbarSearchText.trim() &&
                    navbarSearchHistory.length > 0 &&
                    authUser && (
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={clearNavbarSearchHistory}
                        disabled={navbarSearchClearing}
                        style={{
                          width: "100%",
                          border: "none",
                          borderTop: "1px solid #2d2d36",
                          background: "#15151b",
                          color: "#a78bfa",
                          padding: "11px 15px",
                          textAlign: "center",
                          cursor: navbarSearchClearing ? "wait" : "pointer",
                          fontSize: "12px",
                          fontWeight: "700",
                          opacity: navbarSearchClearing ? 0.7 : 1,
                        }}
                      >
                        {navbarSearchClearing
                          ? "Removing..."
                          : "Remove search history"}
                      </button>
                    )}
                </>
              ) : (
                <div
                  style={{
                    padding: "13px 15px",
                    color: "#777783",
                    fontSize: "13px",
                  }}
                >
                  {navbarSearchText.trim()
                    ? "No related ReelVerse suggestions found."
                    : "No recommendations available yet."}
                </div>
              )}
            </div>
          )}
        </div>


        <div className="nav-actions">

          <button
            className="upload-button"
            onClick={() =>
              navigate("/upload")
            }
          >
            + Upload
          </button>


          <button
            className="notification-button"
            onClick={() =>
              navigate(
                "/notifications"
              )
            }
            style={{
              position: "relative",
            }}
            aria-label="Notifications"
            title={
              hasUnreadNotifications
                ? "You have unread notifications"
                : "Notifications"
            }
          >
            ♢

            {hasUnreadNotifications && (
              <span
                aria-label="Unread notifications"
                style={{
                  position: "absolute",
                  top: "6px",
                  right: "6px",
                  width: "9px",
                  height: "9px",
                  borderRadius: "50%",
                  background: "#a855f7",
                  border: "2px solid #111116",
                  boxSizing: "content-box",
                  pointerEvents: "none",
                }}
              />
            )}
          </button>


          {authUser ? (
            <>
              <div
                className="profile-avatar"
                onClick={() =>
                  navigate(
                    "/profile"
                  )
                }
                style={{
                  cursor: "pointer",
                  overflow: "hidden",
                }}
                title={
                  authUser.username
                }
              >
                {authUser.profile_photo_url ? (
                  <img
                    src={authUser.profile_photo_url}
                    alt={`${authUser.username || "User"} profile`}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      borderRadius: "50%",
                    }}
                  />
                ) : authUser.username ? (
                  authUser.username
                    .charAt(0)
                    .toUpperCase()
                ) : (
                  "U"
                )}
              </div>


              <button
                type="button"
                onClick={logout}
                style={{
                  border:
                    "1px solid #30303a",
                  background:
                    "#18181f",
                  color:
                    "#cfcfd7",
                  borderRadius:
                    "8px",
                  padding:
                    "8px 12px",
                  cursor:
                    "pointer",
                }}
              >
                Logout
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() =>
                navigate("/login")
              }
              style={{
                border:
                  "1px solid #30303a",
                background:
                  "#18181f",
                color:
                  "#ffffff",
                borderRadius:
                  "8px",
                padding:
                  "9px 14px",
                cursor:
                  "pointer",
                fontWeight:
                  "600",
              }}
            >
              Login
            </button>
          )}

        </div>

      </header>


      {/* =================================================
          MAIN LAYOUT
      ================================================= */}

      <div className="main-layout">

        <aside className="sidebar">

          <div className="sidebar-menu">

            {navigationItems.map(
              (item) => (
                <NavLink
                  key={item.name}
                  to={item.path}
                  end={item.end}
                  style={{
                    textDecoration:
                      "none",
                  }}
                  className={({
                    isActive,
                  }) =>
                    `nav-item ${
                      isActive
                        ? "active"
                        : ""
                    }`
                  }
                >
                  <span
                    className="nav-icon"
                    style={{
                      position: "relative",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {item.icon}

                    {item.name === "Messages" &&
                      hasUnreadMessages && (
                        <span
                          aria-label="Unread messages"
                          style={{
                            position: "absolute",
                            top: "-3px",
                            right: "-5px",
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            background: "#a855f7",
                            border: "2px solid #111116",
                            boxSizing: "content-box",
                            pointerEvents: "none",
                          }}
                        />
                      )}
                  </span>

                  {item.name}
                </NavLink>
              )
            )}

          </div>


          <div className="sidebar-divider"></div>


          <div className="sidebar-section">

            <p className="sidebar-title">
              YOUR SPACE
            </p>


            <NavLink
              to="/profile"
              style={{
                textDecoration:
                  "none",
              }}
              className={({
                isActive,
              }) =>
                `nav-item ${
                  isActive
                    ? "active"
                    : ""
                }`
              }
            >
              <span
                className="nav-icon"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7" />
                </svg>
              </span>

              My Profile
            </NavLink>


            <NavLink
              to="/my-videos"
              style={{
                textDecoration:
                  "none",
              }}
              className={({
                isActive,
              }) =>
                `nav-item ${
                  isActive
                    ? "active"
                    : ""
                }`
              }
            >
              <span className="nav-icon">
                ▣
              </span>

              My Videos
            </NavLink>

          </div>


          <div className="sidebar-bottom">
            <p>
              ReelVerse
            </p>

            <span>
              Discover. Create. Share.
            </span>
          </div>

        </aside>


        <main className="content">

          <Routes>

            {/* =================================================
                LOGIN
            ================================================= */}

            <Route
              path="/login"
              element={
                <LoginPage
                  onLogin={setAuthUser}
                />
              }
            />


            {/* =================================================
                REGISTER
            ================================================= */}

            <Route
              path="/register"
              element={
                <RegisterPage />
              }
            />


            {/* =================================================
                HOME
            ================================================= */}

            <Route
              path="/"
              element={
                <HomePage
                  videos={videos}
                  loading={loading}
                  error={error}
                  openVideo={openVideo}
                  openComments={
                    openComments
                  }
                  commentsCount={
                    commentsCount
                  }
                  likedVideos={
                    likedVideos
                  }
                  onToggleLike={
                    toggleLike
                  }
                  likeLoading={
                    likeLoading
                  }
                  bookmarkedVideos={
                    bookmarkedVideos
                  }
                  onToggleBookmark={
                    toggleBookmark
                  }
                  bookmarkLoading={
                    bookmarkLoading
                  }
                />
              }
            />


            {/* =================================================
                EXPLORE
            ================================================= */}

            <Route
              path="/explore"
              element={
                <ExplorePage
                  videos={videos}
                  loading={loading}
                  error={error}
                  openVideo={openVideo}
                  openComments={
                    openComments
                  }
                  commentsCount={
                    commentsCount
                  }
                  likedVideos={
                    likedVideos
                  }
                  onToggleLike={
                    toggleLike
                  }
                  likeLoading={
                    likeLoading
                  }
                  bookmarkedVideos={
                    bookmarkedVideos
                  }
                  onToggleBookmark={
                    toggleBookmark
                  }
                  bookmarkLoading={
                    bookmarkLoading
                  }
                />
              }
            />


            {/* =================================================
                TRENDING
            ================================================= */}

            <Route
              path="/trending"
              element={
                <TrendingPage
                  openVideo={openVideo}
                  openComments={
                    openComments
                  }
                  commentsCount={
                    commentsCount
                  }
                  likedVideos={
                    likedVideos
                  }
                  onToggleLike={
                    toggleLike
                  }
                  likeLoading={
                    likeLoading
                  }
                  bookmarkedVideos={
                    bookmarkedVideos
                  }
                  onToggleBookmark={
                    toggleBookmark
                  }
                  bookmarkLoading={
                    bookmarkLoading
                  }
                />
              }
            />


            {/* =================================================
                FOLLOWING
            ================================================= */}

            <Route
              path="/following"
              element={
                <FollowingPage
                  authUser={authUser}
                  onLoginNavigate={() => navigate("/login")}
                  openVideo={openVideo}
                  openComments={openComments}
                  commentsCount={commentsCount}
                  likedVideos={likedVideos}
                  onToggleLike={toggleLike}
                  likeLoading={likeLoading}
                  bookmarkedVideos={bookmarkedVideos}
                  onToggleBookmark={toggleBookmark}
                  bookmarkLoading={bookmarkLoading}
                />
              }
            />


            {/* =================================================
                MESSAGES
            ================================================= */}

            <Route
              path="/messages"
              element={
                <MessagesPage
                  authUser={authUser}
                  onLoginNavigate={() => navigate("/login")}
                />
              }
            />

            <Route
              path="/messages/:conversationId"
              element={
                <MessagesPage
                  authUser={authUser}
                  onLoginNavigate={() => navigate("/login")}
                />
              }
            />


            {/* =================================================
                BOOKMARKS
            ================================================= */}

            <Route
              path="/bookmarks"
              element={
                <BookmarksPage
                  videos={videos}
                  authUser={authUser}
                  openVideo={openVideo}
                  openComments={
                    openComments
                  }
                  commentsCount={
                    commentsCount
                  }
                  likedVideos={
                    likedVideos
                  }
                  onToggleLike={
                    toggleLike
                  }
                  likeLoading={
                    likeLoading
                  }
                  bookmarkedVideos={
                    bookmarkedVideos
                  }
                  onToggleBookmark={
                    toggleBookmark
                  }
                  bookmarkLoading={
                    bookmarkLoading
                  }
                  onLoginNavigate={() =>
                    navigate(
                      "/login"
                    )
                  }
                />
              }
            />


            {/* =================================================
                HISTORY
            ================================================= */}

            <Route
              path="/history"
              element={
                <HistoryPage
                  authUser={authUser}
                  historyVideos={
                    historyVideos
                  }
                  historyLoading={
                    historyLoading
                  }
                  historyError={
                    historyError
                  }
                  openVideo={openVideo}
                  openComments={
                    openComments
                  }
                  commentsCount={
                    commentsCount
                  }
                  likedVideos={
                    likedVideos
                  }
                  onToggleLike={
                    toggleLike
                  }
                  likeLoading={
                    likeLoading
                  }
                  bookmarkedVideos={
                    bookmarkedVideos
                  }
                  onToggleBookmark={
                    toggleBookmark
                  }
                  bookmarkLoading={
                    bookmarkLoading
                  }
                  onClearHistory={
                    clearHistory
                  }
                  onLoginNavigate={() =>
                    navigate(
                      "/login"
                    )
                  }
                />
              }
            />


            {/* =================================================
                OTHER USER PROFILE - DM STEP 3
            ================================================= */}

            <Route
              path="/users/:userId"
              element={
                <OtherUserProfilePage
                  authUser={authUser}
                  videos={videos}
                  openVideo={openVideo}
                  onLoginNavigate={() => navigate("/login")}
                />
              }
            />


            {/* =================================================
                PROFILE
            ================================================= */}

            <Route
              path="/profile"
              element={
                <ProfilePage
                  authUser={authUser}
                  videos={videos}
                  openVideo={openVideo}
                  onLoginNavigate={() => navigate("/login")}
                  onAuthUserUpdate={updateAuthUser}
                />
              }
            />


            {/* =================================================
                MY VIDEOS
            ================================================= */}

            <Route
              path="/my-videos"
              element={
                <MyVideosPage
                  videos={videos}
                  authUser={authUser}
                  openVideo={openVideo}
                  openComments={
                    openComments
                  }
                  commentsCount={
                    commentsCount
                  }
                  likedVideos={
                    likedVideos
                  }
                  onToggleLike={
                    toggleLike
                  }
                  likeLoading={
                    likeLoading
                  }
                  bookmarkedVideos={
                    bookmarkedVideos
                  }
                  onToggleBookmark={
                    toggleBookmark
                  }
                  bookmarkLoading={
                    bookmarkLoading
                  }
                  onLoginNavigate={() =>
                    navigate(
                      "/login"
                    )
                  }
                />
              }
            />


            {/* =================================================
                UPLOAD
            ================================================= */}

            <Route
              path="/upload"
              element={
                <UploadPage
                  authUser={authUser}
                  onLoginNavigate={() =>
                    navigate("/login")
                  }
                />
              }
            />


            {/* =================================================
                NOTIFICATIONS
            ================================================= */}

            <Route
              path="/notifications"
              element={
                <NotificationsPage
                  authUser={authUser}
                  onLoginNavigate={() => navigate("/login")}
                  onUnreadStatusChange={setHasUnreadNotifications}
                />
              }
            />


            {/* =================================================
                404
            ================================================= */}

            <Route
              path="*"
              element={
                <SimplePage
                  title="Page Not Found"
                  description="The page you are looking for does not exist."
                />
              }
            />

          </Routes>

        </main>

      </div>


      {/* =================================================
          COMMENTS MODAL
      ================================================= */}

      {commentVideo && (
        <CommentsModal
          video={commentVideo}
          comments={comments}
          loading={commentsLoading}
          error={commentsError}
          authUser={authUser}
          onClose={closeComments}
          onLoginNavigate={() =>
            navigate("/login")
          }
          onAddComment={addComment}
          onUpdateComment={
            updateComment
          }
          onDeleteComment={
            deleteComment
          }
          likedComments={
            likedComments
          }
          commentLikeLoading={
            commentLikeLoading
          }
          onToggleCommentLike={
            toggleCommentLike
          }
        />
      )}


      {/* =================================================
          VIDEO PLAYER MODAL
      ================================================= */}

      {selectedVideo && (
        <div
          onClick={closeVideo}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background:
              "rgba(0, 0, 0, 0.88)",
            display: "flex",
            justifyContent: "center",
            // Short screens (phones turned sideways) can scroll the popup
            // instead of cutting off its top.
            overflowY: "auto",
            padding: "clamp(8px, 3vw, 30px)",
          }}
        >
          <div
            onClick={(event) =>
              event.stopPropagation()
            }
            style={{
              margin: "auto",
              flexShrink: 0,
              width:
                "min(1000px, 100%)",
              background:
                "#111116",
              border:
                "1px solid #292932",
              borderRadius:
                "16px",
              overflow:
                "hidden",
              boxShadow:
                "0 30px 80px rgba(0,0,0,0.6)",
            }}
          >

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent:
                  "space-between",
                padding:
                  "14px 18px",
                borderBottom:
                  "1px solid #292932",
              }}
            >
              <div>

                <h3
                  style={{
                    margin: 0,
                    color:
                      "#ffffff",
                    fontSize:
                      "16px",
                  }}
                >
                  {
                    selectedVideo.title
                  }
                </h3>

                <p
                  style={{
                    margin:
                      "4px 0 0",
                    color:
                      "#777783",
                    fontSize:
                      "12px",
                  }}
                >
                  by{" "}
                  {
                    selectedVideo.creator
                  }
                </p>

              </div>


              <button
                onClick={
                  closeVideo
                }
                style={{
                  width:
                    "36px",
                  height:
                    "36px",
                  border:
                    "none",
                  borderRadius:
                    "50%",
                  background:
                    "#24242c",
                  color:
                    "#ffffff",
                  fontSize:
                    "20px",
                  cursor:
                    "pointer",
                }}
              >
                ×
              </button>

            </div>


            <VideoPlayer
              key={
                selectedVideo.id
              }
              video={
                selectedVideo
              }
            />


            <div
              style={{
                padding:
                  "16px 18px",
              }}
            >

              <p
                style={{
                  margin:
                    "0 0 10px",
                  color:
                    "#d0d0d7",
                  fontSize:
                    "14px",
                  lineHeight:
                    "1.6",
                }}
              >
                {
                  selectedVideo.description ||
                  "No description available."
                }
              </p>


              <div
                style={{
                  display:
                    "flex",
                  gap:
                    "20px",
                  color:
                    "#888894",
                  fontSize:
                    "13px",
                }}
              >

                <button
                  type="button"
                  onClick={() =>
                    toggleLike(
                      selectedVideo
                    )
                  }
                  disabled={Boolean(
                    likeLoading[
                      selectedVideo.id
                    ]
                  )}
                  style={{
                    border:
                      "none",
                    background:
                      "transparent",
                    color:
                      likedVideos[
                        selectedVideo.id
                      ]
                        ? "#ff4d6d"
                        : "#888894",
                    padding:
                      0,
                    cursor:
                      likeLoading[
                        selectedVideo.id
                      ]
                        ? "wait"
                        : "pointer",
                    font:
                      "inherit",
                  }}
                  title={
                    likedVideos[
                      selectedVideo.id
                    ]
                      ? "Unlike this video"
                      : "Like this video"
                  }
                >
                  {likedVideos[
                    selectedVideo.id
                  ]
                    ? "♥"
                    : "♡"}{" "}
                  {
                    selectedVideo.likes ||
                    0
                  }
                </button>

                <button
                  type="button"
                  onClick={() =>
                    openComments(
                      selectedVideo
                    )
                  }
                  style={{
                    border:
                      "none",
                    background:
                      "transparent",
                    color:
                      "#888894",
                    padding:
                      0,
                    cursor:
                      "pointer",
                    font:
                      "inherit",
                  }}
                  title="View comments"
                >
                  💬{" "}
                  {
                    commentsCount[
                      selectedVideo.id
                    ] || 0
                  }
                </button>


                <button
                  type="button"
                  onClick={() =>
                    toggleBookmark(
                      selectedVideo
                    )
                  }
                  disabled={Boolean(
                    bookmarkLoading[
                      selectedVideo.id
                    ]
                  )}
                  style={{
                    border:
                      "none",
                    background:
                      "transparent",
                    color:
                      bookmarkedVideos[
                        selectedVideo.id
                      ]
                        ? "#a855f7"
                        : "#888894",
                    padding:
                      0,
                    cursor:
                      bookmarkLoading[
                        selectedVideo.id
                      ]
                        ? "wait"
                        : "pointer",
                    font:
                      "inherit",
                  }}
                  title={
                    bookmarkedVideos[
                      selectedVideo.id
                    ]
                      ? "Remove from bookmarks"
                      : "Save this video"
                  }
                >
                  {bookmarkedVideos[
                    selectedVideo.id
                  ]
                    ? "🔖 Saved"
                    : "🔖 Save"}
                </button>


                <button
                  type="button"
                  onClick={() => shareVideo(selectedVideo)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#888894",
                    padding: 0,
                    cursor: "pointer",
                    font: "inherit",
                  }}
                  title="Copy a link to this video"
                >
                  🔗 Share
                </button>


                <span>
                  ◉{" "}
                  {
                    selectedVideo.views ||
                    0
                  }
                </span>


                <span>
                  {
                    selectedVideo.category
                  }
                </span>

              </div>

            </div>

          </div>
        </div>
      )}

      {shareToast && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: "28px",
            transform: "translateX(-50%)",
            zIndex: 10000,
            maxWidth: "90vw",
            padding: "12px 20px",
            borderRadius: "999px",
            background: "linear-gradient(110deg, #7c3aed, #c026d3)",
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: "700",
            boxShadow: "0 14px 40px rgba(124, 58, 237, 0.5)",
            wordBreak: "break-all",
          }}
        >
          {shareToast}
        </div>
      )}

    </div>
  );
}


// =====================================================
// APP
// =====================================================

function App() {
  return (
    <BrowserRouter>
      <ReelVerseApp />
    </BrowserRouter>
  );
}


export default App;