// ===== 0. GLOBAL TUNABLES =====

// Pull-out animation duration (ms)
const ANIMATION_DURATION = 2800;

// Rotation per frame (we're currently not rotating, just scaling/positioning)
const FRAME_ROTATIONS = [
  { start: 0, end: 0 }, // A0
  { start: 0, end: 0 }, // A1
  { start: 0, end: 0 }, // A2
  { start: 0, end: 0 }, // A3
  { start: 0, end: 0 }, // A4
  { start: 0, end: 0 }, // A5
];

// Growth per frame (relative to base size)
const FRAME_GROWTH = [
  { start: 1.3, end: 1.5 }, // A0
  { start: 1.5, end: 1.7 }, // A1
  { start: 1.7, end: 1.9 }, // A2
  { start: 1.9, end: 2.1 }, // A3
  { start: 2.1, end: 2.3 }, // A4
  { start: 2.3, end: 2.45 }, // A5
];

// Offsets per frame (fractions of w/h)
const FRAME_OFFSETS = [
  { xStart: 0.0, xEnd: 0.0, yStart: -1.85, yEnd: -1.15 }, // A0
  { xStart: 0.0, xEnd: 0.0, yStart: -1.15, yEnd: -0.5 },  // A1
  { xStart: 0.0, xEnd: 0.0, yStart: -0.4,  yEnd: -0.15 }, // A2
  { xStart: 0.0, xEnd: 0.0, yStart: -0.1,  yEnd:  0.0 },  // A3
  { xStart: 0.0, xEnd: 0.0, yStart:  0.0,  yEnd:  0.05 }, // A4
  { xStart: 0.0, xEnd: 0.0, yStart:  0.0,  yEnd:  0.01 }, // A5
];

// Default frame count for A1–A4
const DEFAULT_FRAME_COUNT = 4;
const ALBUM_FRAME_COUNTS = {
  "hiphop-01": 4, // example; others use default
};

// Set of albums that use A0 + A5 animation images
let ANIM_A0_A5_KEYS = null;

// Mix tape album (Country, row 12)
const MIXTAPE_BASE_ID = "country-12";

// ===== MIX PLAYLIST CONSTANTS =====

const MIX_STORAGE_KEY = "cassette_mix_playlists_v1";
const MAX_MIX_PLAYLISTS = 10;
const MAX_TRACKS_PER_MIX = 100;

// ===== SPOTIFY PKCE CONFIG =====

const SPOTIFY_CLIENT_ID = "028596f2c029446ba74477fc6b7f829e";
const SPOTIFY_REDIRECT_URI =
  window.location.origin + window.location.pathname;

let spotifyAccessToken = null;
let spotifyTokenExpiresAt = 0; // ms
let spotifyPostAuthView = null;

// Random string
function spotifyGenerateRandomString(length) {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = window.crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values)
    .map((v) => possible[v % possible.length])
    .join("");
}

async function spotifySha256(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  return window.crypto.subtle.digest("SHA-256", data);
}

function spotifyBase64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function spotifyCreateCodeChallenge(verifier) {
  if (
    !window.crypto ||
    !window.crypto.subtle ||
    typeof window.crypto.subtle.digest !== "function"
  ) {
    // On insecure origins (like http://192.168...:5500) PKCE won't work.
    alert(
      "Spotify Mix features only work when this cassette app is served over HTTPS or localhost.\n\n" +
        "On your current dev URL the Spotify login flow is disabled.\n\n" +
        "Once you publish (for example on GitHub Pages over https://), Mix will work on your phone and desktop."
    );
    return null;
  }

  const hashed = await spotifySha256(verifier);
  return spotifyBase64UrlEncode(hashed);
}

// Start PKCE auth
async function spotifyStartAuth() {
  const codeVerifier = spotifyGenerateRandomString(64);
  const codeChallenge = await spotifyCreateCodeChallenge(codeVerifier);
  if (!codeChallenge) {
    // Could not create challenge on this origin -> bail out
    return;
  }

  const state = spotifyGenerateRandomString(16);

  sessionStorage.setItem("spotify_code_verifier", codeVerifier);
  sessionStorage.setItem("spotify_auth_state", state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: SPOTIFY_CLIENT_ID,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
    state,
    // scopes:
    //  - search: none required
    //  - create playlists: playlist-modify-public or playlist-modify-private
    //  - /me: works with those scopes to get current user id
    scope: "playlist-read-private playlist-modify-private playlist-modify-public",
  });

  window.location.href =
    "https://accounts.spotify.com/authorize?" + params.toString();
}

// Handle redirect ?code=...
async function spotifyHandleRedirectCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const returnedState = params.get("state");
  if (!code) return;

  const storedState = sessionStorage.getItem("spotify_auth_state");
  if (storedState && returnedState && storedState !== returnedState) {
    console.warn("Spotify PKCE state mismatch; ignoring callback.");
    return;
  }
  sessionStorage.removeItem("spotify_auth_state");

  const codeVerifier = sessionStorage.getItem("spotify_code_verifier");
  sessionStorage.removeItem("spotify_code_verifier");
  if (!codeVerifier) {
    console.warn("Missing spotify_code_verifier in sessionStorage.");
    return;
  }

  const body = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    console.error("Spotify token error:", resp.status, await resp.text());
    return;
  }

  const data = await resp.json();
  spotifyAccessToken = data.access_token;
  spotifyTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  spotifyPostAuthView = sessionStorage.getItem("spotify_post_auth_view");
  sessionStorage.removeItem("spotify_post_auth_view");

  // Clean up query string
  window.history.replaceState(
    {},
    document.title,
    window.location.pathname + window.location.hash
  );
}

function spotifyHasValidToken() {
  return (
    spotifyAccessToken &&
    Date.now() < spotifyTokenExpiresAt - 60 * 1000
  );
}

async function ensureSpotifyAccessToken(postAuthView) {
  if (spotifyHasValidToken()) return true;

  if (postAuthView) {
    sessionStorage.setItem("spotify_post_auth_view", postAuthView);
  }

  await spotifyStartAuth(); // may redirect away
  // If we didn't redirect (e.g., insecure origin), we just return false
  return spotifyHasValidToken();
}

// ===== 1. ALBUM DATA =====

const albumData = [
  // Hip Hop (1)
  { artist: "Dr. Dre", album: "The Chronic", genre: "Hip Hop", column: 1, row: 1, spotifyUrl: "https://open.spotify.com/album/2V5rhszUpCudPcb01zevOt" },
  { artist: "2 Live Crew", album: "Banned in the U.S.A.", genre: "Hip Hop", column: 1, row: 2, spotifyUrl: "https://open.spotify.com/album/1dBZatLGpRYvGesXn9JXcY" },
  { artist: "Too Short", album: "Life Is...Too Short", genre: "Hip Hop", column: 1, row: 3, spotifyUrl: "https://open.spotify.com/album/3vuQ0qc1DF5jJ4mz5Thm5J" },
  { artist: "Rob Base & DJ E-Z Rock", album: "It Takes Two", genre: "Hip Hop", column: 1, row: 4, spotifyUrl: "https://open.spotify.com/album/5tocCryeqWvFXn65seo0p6" },
  { artist: "House of Pain", album: "House of Pain", genre: "Hip Hop", column: 1, row: 5, spotifyUrl: "https://open.spotify.com/album/0hWY4eSi2bZ8tWplgjO0ph" },
  { artist: "Ice Cube", album: "The Predator", genre: "Hip Hop", column: 1, row: 6, spotifyUrl: "https://open.spotify.com/album/71HM1CMYWeZzws8pyEn46" },
  { artist: "M.C. Hammer", album: "Please Hammer Don’t Hurt ’Em", genre: "Hip Hop", column: 1, row: 7, spotifyUrl: "https://open.spotify.com/album/4r1WecJyt5FOhglysp9zhN" },
  { artist: "Beastie Boys", album: "Licensed to Ill", genre: "Hip Hop", column: 1, row: 8, spotifyUrl: "https://open.spotify.com/album/11oR0ZuqB3ucZwb5TGbZxb" },
  { artist: "N.W.A", album: "Straight Outta Compton", genre: "Hip Hop", column: 1, row: 9, spotifyUrl: "https://open.spotify.com/album/0Y7qkJVZ06tS2GUCDptzyW" },
  { artist: "Vanilla Ice", album: "To the Extreme", genre: "Hip Hop", column: 1, row: 10, spotifyUrl: "https://open.spotify.com/album/1LHacvoBTd7o2d7wwQ9EZD" },
  { artist: "Run-D.M.C.", album: "Raising Hell", genre: "Hip Hop", column: 1, row: 11, spotifyUrl: "https://open.spotify.com/album/7AFsTiojVaB2I58oZ1tMRg" },
  { artist: "LL Cool J", album: "Mama Said Knock You Out", genre: "Hip Hop", column: 1, row: 12, spotifyUrl: "https://open.spotify.com/album/7p7kcsrdoJ8DKQIMouujcb" },

  // Pop / Rock (2)
  { artist: "The Police", album: "Every Breath You Take – The Singles", genre: "Pop / Rock", column: 2, row: 1, spotifyUrl: "https://open.spotify.com/album/3s9o7LSofJfIZafUgkDe9O" },
  { artist: "Quiet Riot", album: "Metal Health", genre: "Pop / Rock", column: 2, row: 2, spotifyUrl: "https://open.spotify.com/album/3Q3rQ8FK1e9Fd9Gv9xm3CK" },
  { artist: "Depeche Mode", album: "People Are People", genre: "Pop / Rock", column: 2, row: 3, spotifyUrl: "https://open.spotify.com/album/3zA1d01hWRRchi5sGcb3VR" },
  { artist: "Peter Gabriel", album: "So", genre: "Pop / Rock", column: 2, row: 4, spotifyUrl: "https://open.spotify.com/album/1vJ8rCzq6BJtKGz9Yf6oT3" },
  { artist: "Sting", album: "…Nothing Like the Sun", genre: "Pop / Rock", column: 2, row: 5, spotifyUrl: "https://open.spotify.com/album/3W3E9HCTFOcWAavPNfGMJ8" },
  { artist: "George Michael", album: "Faith", genre: "Pop / Rock", column: 2, row: 6, spotifyUrl: "https://open.spotify.com/album/34K1Kvskt9arWy8E1Gz3Lw" },
  { artist: "Dire Straits", album: "Brothers in Arms", genre: "Pop / Rock", column: 2, row: 7, spotifyUrl: "https://open.spotify.com/album/7jvcSnCnugLcisBCNBm60s" },
  { artist: "Tears for Fears", album: "Songs from the Big Chair", genre: "Pop / Rock", column: 2, row: 8, spotifyUrl: "https://open.spotify.com/album/7y7459SFZReE5Wec4hejv5" },
  { artist: "Duran Duran", album: "Rio", genre: "Pop / Rock", column: 2, row: 9, spotifyUrl: "https://open.spotify.com/album/0PqCkTvKFJxzr9uujq7a3T" },
  { artist: "Phil Collins", album: "No Jacket Required", genre: "Pop / Rock", column: 2, row: 10, spotifyUrl: "https://open.spotify.com/album/1rVhockt4RAiZFaK3M3zPB" },
  { artist: "Prince", album: "1999", genre: "Pop / Rock", column: 2, row: 11, spotifyUrl: "https://open.spotify.com/album/2umoqwMrmjBBPeaqgYu6J9" },
  { artist: "INXS", album: "Kick", genre: "Pop / Rock", column: 2, row: 12, spotifyUrl: "https://open.spotify.com/album/7cuwWzS0oiApEt2fpKafkX" },

  // Rock (3)
  { artist: "Footloose", album: "Original Motion Picture Soundtrack", genre: "Rock", column: 3, row: 1, spotifyUrl: "https://open.spotify.com/album/3Tx8adY1323eMrMuvPILpl" },
  { artist: "Lionel Richie", album: "Can’t Slow Down", genre: "Rock", column: 3, row: 2, spotifyUrl: "https://open.spotify.com/album/609oTPBaxPzZUCHzQikOtC" },
  { artist: "Huey Lewis and the News", album: "Fore!", genre: "Rock", column: 3, row: 3, spotifyUrl: "https://open.spotify.com/album/5L0vaNLbzgP8RIJqs1zamE" },
  { artist: "Van Morrison", album: "Moondance", genre: "Rock", column: 3, row: 4, spotifyUrl: "https://open.spotify.com/album/5PfnCqRbdfIDMb1x3MPQam" },
  { artist: "U2", album: "The Joshua Tree", genre: "Rock", column: 3, row: 5, spotifyUrl: "https://open.spotify.com/album/5vBZRYu2GLA65nfxBv1a7" },
  { artist: "Janet Jackson", album: "Rhythm Nation 1814", genre: "Rock", column: 3, row: 6, spotifyUrl: "https://open.spotify.com/album/4OD3LU6001esAtFshDX46M" },
  { artist: "Journey", album: "Frontiers", genre: "Rock", column: 3, row: 7, spotifyUrl: "https://open.spotify.com/album/1Gtf2hZQlOGVER16uemmzR" },
  { artist: "Bruce Springsteen", album: "Born in the U.S.A.", genre: "Rock", column: 3, row: 8, spotifyUrl: "https://open.spotify.com/album/0PMasrHdpaoIRuHuhHp72O" },
  { artist: "Michael Jackson", album: "Thriller", genre: "Rock", column: 3, row: 9, spotifyUrl: "https://open.spotify.com/album/2ANVost0y2y52ema1E9xAZ" },
  { artist: "Madonna", album: "Like a Virgin", genre: "Rock", column: 3, row: 10, spotifyUrl: "https://open.spotify.com/album/2IU9ftOgyRL2caQGWK1jjX" },
  { artist: "Cyndi Lauper", album: "She’s So Unusual", genre: "Rock", column: 3, row: 11, spotifyUrl: "https://open.spotify.com/album/1FvdZ1oizXwF9bxogujoF0" },
  { artist: "Chicago", album: "Greatest Hits 1982–1989", genre: "Rock", column: 3, row: 12, spotifyUrl: "https://open.spotify.com/playlist/0SiVNDqfmWetpRX1N1yCmQ" },

  // Heavy Metal (4)
  { artist: "Metallica", album: "Metallica", genre: "Heavy Metal", column: 4, row: 1, spotifyUrl: "https://open.spotify.com/album/55fq75UfkYbGMq4CncCtOH" },
  { artist: "Mötley Crüe", album: "Girls, Girls, Girls", genre: "Heavy Metal", column: 4, row: 2, spotifyUrl: "https://open.spotify.com/album/0vPZhR1KpbRNBOQBsDScS8" },
  { artist: "Van Halen", album: "1984", genre: "Heavy Metal", column: 4, row: 3, spotifyUrl: "https://open.spotify.com/album/3REUXdj5OPKhuDTrTtCBU0" },
  { artist: "Nirvana", album: "Nevermind", genre: "Heavy Metal", column: 4, row: 4, spotifyUrl: "https://open.spotify.com/album/2guirTSEqLizK7j9i1MTTZ" },
  { artist: "The Black Crowes", album: "Shake Your Money Maker", genre: "Heavy Metal", column: 4, row: 5, spotifyUrl: "https://open.spotify.com/album/2NRRQLuW6j3EsoWpIl2MR3" },
  { artist: "Tom Petty", album: "Full Moon Fever", genre: "Heavy Metal", column: 4, row: 6, spotifyUrl: "https://open.spotify.com/album/5d71Imt5CIb7LpQwDMQ093" },
  { artist: "Pearl Jam", album: "Ten", genre: "Heavy Metal", column: 4, row: 7, spotifyUrl: "https://open.spotify.com/album/5B4PYA7wNN4WdEXdIJu58a" },
  { artist: "Guns N’ Roses", album: "Appetite for Destruction", genre: "Heavy Metal", column: 4, row: 8, spotifyUrl: "https://open.spotify.com/album/28yHV3Gdg30AiB8h8em1eW" },
  { artist: "Def Leppard", album: "Hysteria", genre: "Heavy Metal", column: 4, row: 9, spotifyUrl: "https://open.spotify.com/album/1ja2qzCrh6bZykcojbZs82" },
  { artist: "AC/DC", album: "Back in Black", genre: "Heavy Metal", column: 4, row: 10, spotifyUrl: "https://open.spotify.com/album/6mUdeDZCsExyJLMdAfDuwh" },
  { artist: "Bon Jovi", album: "Slippery When Wet", genre: "Heavy Metal", column: 4, row: 11, spotifyUrl: "https://open.spotify.com/album/0kBfgEilUFCMIQY5IOjG4t" },
  { artist: "Aerosmith", album: "Greatest Hits", genre: "Heavy Metal", column: 4, row: 12, spotifyUrl: "https://open.spotify.com/album/5Z3bU10WcD9JOt98mui7DC" },

  // Country (5)
  { artist: "Waylon Jennings", album: "Greatest Hits", genre: "Country", column: 5, row: 1, spotifyUrl: "https://open.spotify.com/album/5Fx4B1UYRtbc3sbhca9OZo" },
  { artist: "David Allan Coe", album: "Greatest Hits", genre: "Country", column: 5, row: 2, spotifyUrl: "https://open.spotify.com/album/0VYmJzCaXoph0JfVXGNNos" },
  { artist: "Alan Jackson", album: "A Lot About Livin’ (And a Little ’Bout Love)", genre: "Country", column: 5, row: 3, spotifyUrl: "https://open.spotify.com/album/79yCfWigSGt94zi1CIkkJZ" },
  { artist: "Kenny Rogers", album: "Greatest Hits", genre: "Country", column: 5, row: 4, spotifyUrl: "https://open.spotify.com/album/5Cum33m0MK39JjWvbGO8bQ" },
  { artist: "Don Williams", album: "20 Greatest Hits", genre: "Country", column: 5, row: 5, spotifyUrl: "https://open.spotify.com/album/1EoBcNqFMobg6Wrzskv6G9" },
  { artist: "Alabama", album: "Alabama Live", genre: "Country", column: 5, row: 6, spotifyUrl: "https://open.spotify.com/album/4P3SBjcE4PLO8ArJ17sXoh" },
  { artist: "Willie Nelson", album: "Greatest Hits (And Some That Will Be)", genre: "Country", column: 5, row: 7, spotifyUrl: "https://open.spotify.com/album/7oRkZF4ysrOnGThgSiUtUC" },
  { artist: "Robert Earl Keen", album: "A Bigger Piece of Sky", genre: "Country", column: 5, row: 8, spotifyUrl: "https://open.spotify.com/album/7icbWmyzOlrSf9VkBCXCbz" },
  { artist: "Jerry Jeff Walker", album: "¡Viva Terlingua!", genre: "Country", column: 5, row: 9, spotifyUrl: "https://open.spotify.com/album/526pp31N1ObvGLB4ktvmCX" },
  { artist: "George Strait", album: "Greatest Hits Volume Two", genre: "Country", column: 5, row: 10, spotifyUrl: "https://open.spotify.com/album/2ZN1GwIaBhc9exRqKI0gad" },
  { artist: "Garth Brooks", album: "In Pieces", genre: "Country", column: 5, row: 11, spotifyUrl: "https://youtu.be/dQw4w9WgXcQ?si=RgNmyrsWH8hAl49q" },
  { artist: "The Allman Brothers Band", album: "A Decade of Hits 1969-1979", genre: "Country", column: 5, row: 12, spotifyUrl: "https://open.spotify.com/album/4HKQRECxozbRjqfNU0h0VX" },
];

const columnKey = { 1: "hiphop", 2: "poprock", 3: "rock", 4: "metal", 5: "country" };

const genreNames = {
  hiphop: "Hip Hop",
  poprock: "Pop / Rock",
  rock: "Rock",
  metal: "Heavy Metal",
  country: "Country",
};

function buildGenres() {
  const groups = {};
  albumData.forEach((a) => {
    const key = columnKey[a.column];
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  });

  const result = Object.keys(groups).map((key) => {
    const albums = groups[key]
      .sort((a, b) => a.row - b.row)
      .map((a) => {
        const rowStr = String(a.row).padStart(2, "0");
        const baseId = `${key}-${rowStr}`;
        return {
          artist: a.artist,
          album: a.album,
          title: `${a.artist} – ${a.album}`,
          row: a.row,
          baseId,
          image: `img/${baseId}.png`,
          faceImage: `img/${baseId}-face.png`,
          spotifyUrl: a.spotifyUrl,
        };
      });

    const column = Number(
      Object.keys(columnKey).find((c) => columnKey[c] === key)
    );
    return { id: key, name: genreNames[key], column, albums };
  });

  result.sort((a, b) => a.column - b.column);
  return result;
}

const GENRES = buildGenres();
ANIM_A0_A5_KEYS = new Set(GENRES.flatMap((g) => g.albums.map((a) => a.baseId)));

// ===== STATE =====

const state = {
  view: "home",
  genreIndex: 0,
  albumIndex: 0,
  mixtape: {
    lastQuery: "",
    results: [], // search results
    mixStore: null, // playlists structure (loaded from localStorage)
    // NEW: Phase 2 UI state
    ui: {
      tracksCollapsed: false,
      searchCollapsed: false,
    },
  },
};

// ===== HAPTIC =====

function hapticTap() {
  try {
    if (navigator && typeof navigator.vibrate === "function") {
      navigator.vibrate(20);
    }
  } catch {
    // ignore
  }
}

// ===== DOM =====

const appEl = document.getElementById("app");

const homeShelfEl = document.getElementById("home-shelf");
const genreShelfEl = document.getElementById("genre-shelf");
const albumStripEl = document.getElementById("album-strip");
const stageEl = document.querySelector(".album-stage");

const overlayEl = document.getElementById("cassette-overlay");
const cassetteFrameEl = document.getElementById("cassette-frame");

const homeGenreButtons = Array.from(
  document.querySelectorAll(".home-genre-btn")
);
const genrePrevBtn = document.getElementById("genre-prev");
const genreNextBtn = document.getElementById("genre-next");
const genreBackBtn = document.getElementById("genre-back");
const albumPrevBtn = document.getElementById("album-prev");
const albumNextBtn = document.getElementById("album-next");
const albumBackBtn = document.getElementById("album-back");
const albumPlayBtn = document.getElementById("album-play");

// Mix DOM
const mixtapeNavBackBtn = document.getElementById("mixtape-back");
const mixtapeFormEl = document.getElementById("mixtape-search-form");
const mixtapeQueryEl = document.getElementById("mixtape-query");
const mixtapeTracksEl = document.getElementById("mixtape-tracks");
const mixtapeResultsEl = document.getElementById("mixtape-results");
const mixtapeClearBtn = document.getElementById("mixtape-clear");

// NEW: Phase 2 panel elements
const mixtapeWrapperEl = document.querySelector("#mixtape-view .mixtape-wrapper");
const mixtapeTracksPanelEl = document.querySelector("#mixtape-view .mixtape-panel--tracks");
const mixtapeSearchPanelEl = document.querySelector("#mixtape-view .mixtape-panel--search");
const mixtapeCollapseBtns = Array.from(
  document.querySelectorAll("#mixtape-view .mixtape-collapse-btn")
);

const mixtapePlaylistSelectEl = document.getElementById(
  "mixtape-playlist-select"
);
const mixtapeSelectOpenBtn = document.getElementById("mixtape-select-open");

if (mixtapeSelectOpenBtn && mixtapePlaylistSelectEl) {
  mixtapeSelectOpenBtn.addEventListener("click", () => {
    // Focus then click the native select (works on desktop; iOS will still show native picker)
    mixtapePlaylistSelectEl.focus({ preventScroll: true });
    mixtapePlaylistSelectEl.click();
  });
}
const mixtapeNewPlaylistBtn = document.getElementById(
  "mixtape-new-playlist"
);
const mixtapeRenamePlaylistBtn = document.getElementById(
  "mixtape-rename-playlist"
);
const mixtapeDeletePlaylistBtn = document.getElementById(
  "mixtape-delete-playlist"
);
const mixtapeSavePlaylistBtn = document.getElementById(
  "mixtape-save-playlist"
);
const mixtapeTrackCountEl = document.getElementById("mixtape-track-count");
const mixtapeTotalDurationEl = document.getElementById(
  "mixtape-total-duration"
);
const mixtapeAudioEl = document.getElementById("mixtape-audio");

// Track currently previewing (id)
let currentPreviewId = null;

// ===== VIEW MANAGEMENT =====

function setView(view) {
  state.view = view;
  appEl.classList.remove(
    "view-home",
    "view-genre",
    "view-album",
    "view-mixtape"
  );
  appEl.classList.add(`view-${view}`);

  if (view === "home") {
    renderHomeShelf();
  } else if (view === "genre") {
    renderGenreShelf();
  } else if (view === "album") {
    renderAlbumView();
  } else if (view === "mixtape") {
    renderMixtapeView();
  }

  updateNavButtons();
}

function getCurrentAlbum() {
  const genre = GENRES[state.genreIndex];
  if (!genre) return null;
  return genre.albums[state.albumIndex] || null;
}

function isMixTapeAlbum(album) {
  return album && album.baseId === MIXTAPE_BASE_ID;
}

function updateNavButtons() {
  if (state.view === "genre") {
    genrePrevBtn.disabled = state.genreIndex === 0;
    genreNextBtn.disabled = state.genreIndex === GENRES.length - 1;
  }

  if (state.view === "album") {
    const albums = GENRES[state.genreIndex].albums;
    albumPrevBtn.disabled = state.albumIndex === 0;
    albumNextBtn.disabled = state.albumIndex === albums.length - 1;

    const album = getCurrentAlbum();
    if (isMixTapeAlbum(album)) {
      albumPlayBtn.textContent = "Mix";
      albumPlayBtn.onclick = async () => {
        hapticTap();
        const ok = await ensureSpotifyAccessToken("mixtape");
        if (ok) setView("mixtape");
      };
    } else {
      albumPlayBtn.textContent = "Play";
      albumPlayBtn.onclick = () => {
        hapticTap();
        playCurrentAlbum();
      };
    }
  }

  if (state.view !== "album") {
    albumPlayBtn.onclick = () => {
      hapticTap();
      playCurrentAlbum();
    };
  }
}

// ===== HOME VIEW =====

function renderHomeShelf() {
  homeShelfEl.innerHTML = "";

  GENRES.forEach((genre, genreIndex) => {
    const col = document.createElement("div");
    col.className = "genre-column";
    col.dataset.genreId = genre.id;

    const header = document.createElement("div");
    header.className = "genre-header";

    const nameEl = document.createElement("div");
    nameEl.className = "genre-name";
    nameEl.textContent = genre.name;
    header.appendChild(nameEl);
    col.appendChild(header);

    const list = document.createElement("div");
    list.className = "album-list";

    genre.albums.forEach((album, albumIndex) => {
      const spine = document.createElement("div");
      spine.className = "album-spine";

      const img = document.createElement("img");
      img.src = album.image;
      img.alt = album.title;

      spine.appendChild(img);

      spine.addEventListener("click", (e) => {
        e.stopPropagation();
        state.genreIndex = genreIndex;
        state.albumIndex = albumIndex;
        setView("genre");
      });

      list.appendChild(spine);
    });

    col.addEventListener("click", () => {
      state.genreIndex = genreIndex;
      state.albumIndex = 0;
      setView("genre");
    });

    col.appendChild(list);
    homeShelfEl.appendChild(col);
  });
}

// ===== GENRE VIEW =====

function updateGenreShelfOffset() {
  const columns = Array.from(
    genreShelfEl.querySelectorAll(".genre-column")
  );
  if (!columns.length) return;

  const activeCol = columns[state.genreIndex];
  const shelfRect = genreShelfEl.getBoundingClientRect();
  const colRect = activeCol.getBoundingClientRect();

  const shelfCenter = shelfRect.width / 2;
  const activeCenter =
    colRect.left - shelfRect.left + colRect.width / 2;

  const delta = shelfCenter - activeCenter;
  genreShelfEl.style.setProperty("--shelf-offset", `${delta}px`);
}

function renderGenreShelf() {
  genreShelfEl.innerHTML = "";

  GENRES.forEach((genre, genreIndex) => {
    const col = document.createElement("div");
    col.className = "genre-column";
    col.dataset.genreId = genre.id;

    const header = document.createElement("div");
    header.className = "genre-header";

    const nameEl = document.createElement("div");
    nameEl.className = "genre-name";
    nameEl.textContent = genre.name;
    header.appendChild(nameEl);
    col.appendChild(header);

    const list = document.createElement("div");
    list.className = "album-list";

    genre.albums.forEach((album, albumIndex) => {
      const spine = document.createElement("div");
      spine.className = "album-spine";

      const img = document.createElement("img");
      img.src = album.image;
      img.alt = album.title;

      spine.appendChild(img);

      spine.addEventListener("click", (e) => {
        e.stopPropagation();
        hapticTap();

        if (genreIndex === state.genreIndex) {
          startFrameAnimation(spine, genre, albumIndex);
        } else {
          state.genreIndex = genreIndex;
          state.albumIndex = albumIndex;
          renderGenreShelf();
        }
      });

      list.appendChild(spine);
    });

    col.addEventListener("click", () => {
      if (genreIndex !== state.genreIndex) {
        state.genreIndex = genreIndex;
        state.albumIndex = 0;
        renderGenreShelf();
      }
    });

    col.appendChild(list);
    genreShelfEl.appendChild(col);
  });

  updateGenreShelfOffset();
  updateNavButtons();
}

// ===== ANIMATION (FRAME SEQUENCE) =====

function buildFrameList(album) {
  const frames = [];
  const key = album.baseId;
  const count = ALBUM_FRAME_COUNTS[key] ?? DEFAULT_FRAME_COUNT;
  const usesA0A5 = ANIM_A0_A5_KEYS.has(key);

  if (usesA0A5) frames.push(`img/${key}-A0.png`);
  else frames.push(album.image);

  for (let i = 1; i <= count; i++) {
    frames.push(`img/${key}-A${i}.png`);
  }

  if (usesA0A5) frames.push(`img/${key}-A5.png`);
  else frames.push(album.faceImage);

  return frames;
}

function preloadFrames(frames) {
  frames.forEach((src) => {
    const img = new Image();
    img.src = src;
  });
}

function startFrameAnimation(spineEl, genre, albumIndex) {
  const album = genre.albums[albumIndex];
  if (!album) {
    setView("album");
    return;
  }

  const frames = buildFrameList(album);
  preloadFrames(frames);

  const rect = spineEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  overlayEl.style.display = "block";
  cassetteFrameEl.style.opacity = "1";

  const startW = rect.width;
  const startH = rect.height;
  const startCx = rect.left + rect.width / 2;
  const startCy = rect.top + rect.height / 2;

  cassetteFrameEl.style.width = `${startW}px`;
  cassetteFrameEl.style.left = `${startCx - startW / 2}px`;
  cassetteFrameEl.style.top = `${startCy - startH / 2}px`;
  cassetteFrameEl.src = frames[0];

  const baseTargetW = Math.min(viewportWidth * 0.6, 360);
  const targetW = baseTargetW * 0.75;
  const targetH = targetW;

  const targetCx = viewportWidth / 2;
  const targetCy = viewportHeight / 2;

  const duration = ANIMATION_DURATION;
  const startTime = performance.now();

  spineEl.style.opacity = "0";

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);

    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    const baseW = startW + (targetW - startW) * ease;
    const baseH = startH + (targetH - startH) * ease;

    const cx = startCx + (targetCx - startCx) * ease;
    const cy = startCy + (targetCy - startCy) * ease;

    const frameCount = frames.length;
    const eps = 1e-4;

    let pos = t * frameCount;
    if (pos >= frameCount) pos = frameCount - eps;
    if (pos < 0) pos = 0;

    const index = Math.floor(pos);
    const localT = pos - index;

    cassetteFrameEl.src = frames[index];

    const rotConfig =
      FRAME_ROTATIONS[index] ||
      FRAME_ROTATIONS[FRAME_ROTATIONS.length - 1];
    const angle =
      rotConfig.start + (rotConfig.end - rotConfig.start) * localT;

    const growthConfig =
      FRAME_GROWTH[index] ||
      FRAME_GROWTH[FRAME_GROWTH.length - 1];
    const growth =
      growthConfig.start +
      (growthConfig.end - growthConfig.start) * localT;

    const offsetConfig =
      FRAME_OFFSETS[index] ||
      FRAME_OFFSETS[FRAME_OFFSETS.length - 1];
    const offsetXFrac =
      offsetConfig.xStart +
      (offsetConfig.xEnd - offsetConfig.xStart) * localT;
    const offsetYFrac =
      offsetConfig.yStart +
      (offsetConfig.yEnd - offsetConfig.yStart) * localT;

    const w = baseW * growth;
    const h = baseH * growth;

    const offsetX = offsetXFrac * w;
    const offsetY = offsetYFrac * h;

    const left = cx - w / 2 + offsetX;
    const top = cy - h / 2 + offsetY;

    cassetteFrameEl.style.width = `${w}px`;
    cassetteFrameEl.style.left = `${left}px`;
    cassetteFrameEl.style.top = `${top}px`;
    cassetteFrameEl.style.transform = `translate3d(0,0,0) rotate(${angle}deg)`;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      cassetteFrameEl.src = frames[frames.length - 1];

      const finalRot =
        FRAME_ROTATIONS[FRAME_ROTATIONS.length - 1] || {
          start: 0,
          end: 0,
        };
      const finalGrowth =
        FRAME_GROWTH[FRAME_GROWTH.length - 1] || { start: 1, end: 1 };
      const finalOffset =
        FRAME_OFFSETS[FRAME_OFFSETS.length - 1] || {
          xStart: 0,
          xEnd: 0,
          yStart: 0,
          yEnd: 0,
        };

      const finalW = baseW * finalGrowth.end;
      const finalH = baseH * finalGrowth.end;
      const finalOffsetX = finalOffset.xEnd * finalW;
      const finalOffsetY = finalOffset.yEnd * finalH;

      const finalLeft = targetCx - finalW / 2 + finalOffsetX;
      const finalTop = targetCy - finalH / 2 + finalOffsetY;

      cassetteFrameEl.style.width = `${finalW}px`;
      cassetteFrameEl.style.left = `${finalLeft}px`;
      cassetteFrameEl.style.top = `${finalTop}px`;
      cassetteFrameEl.style.transform = `translate3d(0,0,0) rotate(${finalRot.end}deg)`;

      const genreIndex = GENRES.findIndex((g) => g.id === genre.id);
      if (genreIndex !== -1) {
        state.genreIndex = genreIndex;
        state.albumIndex = albumIndex;
      }
      setView("album");

      cassetteFrameEl.style.transition = "opacity 250ms ease-out";
      cassetteFrameEl.style.opacity = "0";

      setTimeout(() => {
        overlayEl.style.display = "none";
        cassetteFrameEl.style.transition = "none";
        spineEl.style.opacity = "1";
        cassetteFrameEl.style.transform =
          "translate3d(0,0,0) rotate(0deg)";
      }, 260);
    }
  }

  requestAnimationFrame(step);
}

// ===== ALBUM VIEW =====

function updateAlbumOffset() {
  const cards = Array.from(
    albumStripEl.querySelectorAll(".album-card")
  );
  if (!cards.length || !stageEl) return;

  const maxIndex = cards.length - 1;
  state.albumIndex = Math.max(0, Math.min(state.albumIndex, maxIndex));

  const activeCard = cards[state.albumIndex];
  const isCoarsePointer =
    window.matchMedia("(pointer: coarse)").matches;

  if (isCoarsePointer) {
    const cardWidth = activeCard.offsetWidth;
    const stripStyles = getComputedStyle(albumStripEl);
    let gap = parseFloat(
      stripStyles.columnGap || stripStyles.gap || "0"
    );
    if (Number.isNaN(gap)) gap = 0;

    const i = state.albumIndex;
    const cardCenterInStrip =
      i * (cardWidth + gap) + cardWidth / 2;
    const stageWidth = stageEl.clientWidth;
    const stageCenterInStrip = stageWidth / 2;
    const neededOffset = stageCenterInStrip - cardCenterInStrip;
    albumStripEl.style.setProperty(
      "--album-offset",
      `${neededOffset}px`
    );
  } else {
    const stripRect = albumStripEl.getBoundingClientRect();
    const cardRect = activeCard.getBoundingClientRect();
    const stageRect = stageEl.getBoundingClientRect();

    const cardCenterInStrip =
      cardRect.left - stripRect.left + cardRect.width / 2;
    const stageCenterInStrip =
      stageRect.left - stripRect.left + stageRect.width / 2;

    const neededOffset = stageCenterInStrip - cardCenterInStrip;
    albumStripEl.style.setProperty(
      "--album-offset",
      `${neededOffset}px`
    );
  }

  cards.forEach((c, idx) =>
    c.classList.toggle("active", idx === state.albumIndex)
  );
  updateNavButtons();
}

function renderAlbumView() {
  const genre = GENRES[state.genreIndex];
  const albums = genre.albums;

  albumStripEl.style.setProperty("--album-offset", "0px");
  albumStripEl.innerHTML = "";

  albums.forEach((album, index) => {
    const card = document.createElement("div");
    card.className = "album-card";
    if (index === state.albumIndex) card.classList.add("active");

    const img = document.createElement("img");
    img.src = album.faceImage;
    img.alt = album.title;

    card.appendChild(img);

    card.addEventListener("click", () => {
      if (index === state.albumIndex) {
        hapticTap();
        if (isMixTapeAlbum(album)) {
          (async () => {
            const ok = await ensureSpotifyAccessToken("mixtape");
            if (ok) setView("mixtape");
          })();
        } else {
          playCurrentAlbum();
        }
      } else {
        state.albumIndex = index;
        updateAlbumOffset();
      }
    });

    albumStripEl.appendChild(card);
  });

  requestAnimationFrame(updateAlbumOffset);
}

// ===== SWIPE GESTURES =====

function setupSwipe(element, onSwipeLeft, onSwipeRight) {
  if (!element) return;
  let startX = 0;

  element.addEventListener(
    "touchstart",
    (e) => {
      startX = e.changedTouches[0].clientX;
    },
    { passive: true }
  );

  element.addEventListener(
    "touchend",
    (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      const threshold = 30;
      if (Math.abs(dx) < threshold) return;

      if (dx < 0) onSwipeLeft && onSwipeLeft();
      else onSwipeRight && onSwipeRight();
    },
    { passive: true }
  );
}

setupSwipe(
  document.querySelector(".album-stage"),
  () => {
    const albums = GENRES[state.genreIndex].albums;
    if (
      state.view === "album" &&
      state.albumIndex < albums.length - 1
    ) {
      state.albumIndex++;
      updateAlbumOffset();
    }
  },
  () => {
    if (state.view === "album" && state.albumIndex > 0) {
      state.albumIndex--;
      updateAlbumOffset();
    }
  }
);

setupSwipe(
  document.querySelector("#genre-view"),
  () => {
    if (state.view === "genre" && state.genreIndex < GENRES.length - 1) {
      state.genreIndex++;
      renderGenreShelf();
    }
  },
  () => {
    if (state.view === "genre" && state.genreIndex > 0) {
      state.genreIndex--;
      renderGenreShelf();
    }
  }
);

// ===== PLAY / NAV =====

function playCurrentAlbum() {
  const album = getCurrentAlbum();
  if (album && album.spotifyUrl) {
    window.open(album.spotifyUrl, "_blank");
  }
}

// ===== MIX PLAYLIST STORAGE =====

function loadMixStore() {
  try {
    const raw = localStorage.getItem(MIX_STORAGE_KEY);
    if (!raw) {
      return {
        currentPlaylistId: null,
        playlists: [],
      };
    }
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      !Array.isArray(parsed.playlists)
    ) {
      return {
        currentPlaylistId: null,
        playlists: [],
      };
    }
    return parsed;
  } catch (e) {
    console.warn("Error reading mix storage:", e);
    return {
      currentPlaylistId: null,
      playlists: [],
    };
  }
}

function saveMixStore(store) {
  try {
    localStorage.setItem(MIX_STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn("Error saving mix storage:", e);
  }
}

function ensureMixStore() {
  if (!state.mixtape.mixStore) {
    state.mixtape.mixStore = loadMixStore();
  }
  const store = state.mixtape.mixStore;
  if (!store.playlists.length) {
    const id = "mix-1";
    store.playlists.push({
      id,
      name: "My Mix",
      createdAt: Date.now(),
      tracks: [],
    });
    store.currentPlaylistId = id;
    saveMixStore(store);
  }
  if (!store.currentPlaylistId) {
    store.currentPlaylistId = store.playlists[0].id;
    saveMixStore(store);
  }
}

function getCurrentMixStore() {
  ensureMixStore();
  return state.mixtape.mixStore;
}

function getCurrentPlaylist() {
  const store = getCurrentMixStore();
  return (
    store.playlists.find(
      (p) => p.id === store.currentPlaylistId
    ) || store.playlists[0]
  );
}

// ===== MIX PLAYLIST UI =====

function renderMixPlaylistBar() {
  ensureMixStore();
  const store = getCurrentMixStore();

  mixtapePlaylistSelectEl.innerHTML = "";
  store.playlists.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === store.currentPlaylistId) opt.selected = true;
    mixtapePlaylistSelectEl.appendChild(opt);
  });
}

function formatDurationMs(ms) {
  if (!ms || ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function renderMixSummary() {
  const playlist = getCurrentPlaylist();
  const trackCount = playlist.tracks.length;
  const totalMs = playlist.tracks.reduce(
    (sum, t) => sum + (t.durationMs || 0),
    0
  );
  mixtapeTrackCountEl.textContent =
    trackCount === 1 ? "1 track" : `${trackCount} tracks`;
  mixtapeTotalDurationEl.textContent = formatDurationMs(totalMs);
}

function stopPreview() {
  if (!mixtapeAudioEl) return;
  mixtapeAudioEl.pause();
  mixtapeAudioEl.currentTime = 0;
  currentPreviewId = null;
}

// Render playlist tracks + search results into separate panels
function renderMixtapeResults() {
  const { results, lastQuery } = state.mixtape;
  const store = getCurrentMixStore();
  const playlist = getCurrentPlaylist();

  // --- CURRENT TRACKS PANEL ---
  if (mixtapeTracksEl) {
    mixtapeTracksEl.innerHTML = "";

    if (!playlist.tracks.length) {
      const emptyPl = document.createElement("div");
      emptyPl.className = "mixtape-results-empty";
      emptyPl.textContent = "No tracks yet. Use search to add songs.";
      mixtapeTracksEl.appendChild(emptyPl);
    } else {
      playlist.tracks.forEach((t, idx) => {
        const row = document.createElement("div");
        row.className = "mixtape-item mixtape-playlist-item";

        const thumb = document.createElement("div");
        thumb.className = "mixtape-thumb";
        if (t.imageUrl) {
          const img = document.createElement("img");
          img.src = t.imageUrl;
          img.alt = t.title;
          thumb.appendChild(img);
        }
        row.appendChild(thumb);

        const text = document.createElement("div");
        text.className = "mixtape-text";

        const title = document.createElement("div");
        title.className = "mixtape-track";
        title.textContent = t.title;
        text.appendChild(title);

        const meta = document.createElement("div");
        meta.className = "mixtape-meta";
        const dur = formatDurationMs(t.durationMs);
        meta.textContent = `${t.subtitle} • ${dur}`;
        text.appendChild(meta);

        row.appendChild(text);

        // Actions (preview, up/down, remove)
        const actions = document.createElement("div");
        actions.className = "mixtape-actions";

        // Preview
        if (t.previewUrl) {
          const previewBtn = document.createElement("button");
          previewBtn.type = "button";
          previewBtn.className = "nav-pill mixtape-preview-btn";
          const isPlaying = currentPreviewId === t.id;
          previewBtn.textContent = isPlaying ? "⏸" : "▶";
          previewBtn.addEventListener("click", () => {
            if (!mixtapeAudioEl) return;
            if (currentPreviewId === t.id) {
              stopPreview();
              renderMixtapeResults();
              return;
            }
            // start playing this track
            stopPreview();
            currentPreviewId = t.id;
            mixtapeAudioEl.src = t.previewUrl;
            mixtapeAudioEl.play().catch(() => {
              currentPreviewId = null;
            });
            renderMixtapeResults();
          });
          actions.appendChild(previewBtn);
        }

        // Up
        const upBtn = document.createElement("button");
        upBtn.type = "button";
        upBtn.className = "nav-pill";
        upBtn.textContent = "↑";
        upBtn.disabled = idx === 0;
        upBtn.addEventListener("click", () => {
          const arr = playlist.tracks;
          if (idx > 0) {
            [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
            saveMixStore(store);
            renderMixSummary();
            renderMixtapeResults();
          }
        });
        actions.appendChild(upBtn);

        // Down
        const downBtn = document.createElement("button");
        downBtn.type = "button";
        downBtn.className = "nav-pill";
        downBtn.textContent = "↓";
        downBtn.disabled = idx === playlist.tracks.length - 1;
        downBtn.addEventListener("click", () => {
          const arr = playlist.tracks;
          if (idx < arr.length - 1) {
            [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
            saveMixStore(store);
            renderMixSummary();
            renderMixtapeResults();
          }
        });
        actions.appendChild(downBtn);

        // Remove
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "nav-pill";
        delBtn.textContent = "✕";
        delBtn.addEventListener("click", () => {
          playlist.tracks.splice(idx, 1);
          saveMixStore(store);
          if (t.id === currentPreviewId) {
            stopPreview();
          }
          renderMixSummary();
          renderMixtapeResults();
        });
        actions.appendChild(delBtn);

        row.appendChild(actions);
        mixtapeTracksEl.appendChild(row);
      });
    }
  }

  // --- SEARCH RESULTS PANEL ---
  if (!mixtapeResultsEl) return;
  mixtapeResultsEl.innerHTML = "";

  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "mixtape-results-empty";
    empty.textContent = lastQuery
      ? `No results found for “${lastQuery}”.`
      : "Search to build your mix.";
    mixtapeResultsEl.appendChild(empty);
    return;
  }

  results.forEach((item) => {
    const row = document.createElement("div");
    row.className =
      "mixtape-item" + (item.type !== "track" ? " clickable" : "");

    const thumb = document.createElement("div");
    thumb.className = "mixtape-thumb";
    if (item.imageUrl) {
      const img = document.createElement("img");
      img.src = item.imageUrl;
      img.alt = item.title;
      thumb.appendChild(img);
    }
    row.appendChild(thumb);

    const text = document.createElement("div");
    text.className = "mixtape-text";

    const title = document.createElement("div");
    title.className = "mixtape-track";
    title.textContent = item.title;
    text.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "mixtape-meta";
    meta.textContent = item.subtitle;
    text.appendChild(meta);

    row.appendChild(text);

    if (item.type === "track") {
      const actions = document.createElement("div");
      actions.className = "mixtape-actions";

      // ADD button
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "nav-pill";
      addBtn.textContent = "Add";
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // prevent row click behavior
        const store = getCurrentMixStore();
        const playlist = getCurrentPlaylist();

        if (playlist.tracks.length >= MAX_TRACKS_PER_MIX) {
          alert(
            `This mix already has ${MAX_TRACKS_PER_MIX} tracks. ` +
              "Remove a track before adding more."
          );
          return;
        }

        playlist.tracks.push({
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          imageUrl: item.imageUrl,
          url: item.url,
          uri: item.uri,
          durationMs: item.durationMs || 0,
          previewUrl: item.previewUrl || null,
        });

        saveMixStore(store);
        renderMixSummary();
        renderMixtapeResults();
      });
      actions.appendChild(addBtn);

      // OPEN button
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "nav-pill";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // prevent row click behavior
        if (item.url) window.open(item.url, "_blank");
      });
      actions.appendChild(openBtn);

      // IMPORTANT: this is what was missing
      row.appendChild(actions);
    } else {
      // artist / album -> open on click (whole row acts like a link)
      row.addEventListener("click", () => {
        if (item.url) window.open(item.url, "_blank");
      });
    }


    mixtapeResultsEl.appendChild(row);
  });
}

function applyMixtapePanelLayout() {
  if (!mixtapeWrapperEl || !mixtapeTracksPanelEl || !mixtapeSearchPanelEl) return;

  const { tracksCollapsed, searchCollapsed } = state.mixtape.ui;

  // Determine mode based on collapse flags
  let mode = "both";
  if (tracksCollapsed && searchCollapsed) mode = "none";
  else if (!tracksCollapsed && searchCollapsed) mode = "tracks";
  else if (tracksCollapsed && !searchCollapsed) mode = "search";

  // Apply wrapper class
  mixtapeWrapperEl.classList.remove(
    "panel-mode-both",
    "panel-mode-tracks",
    "panel-mode-search",
    "panel-mode-none"
  );
  mixtapeWrapperEl.classList.add(`panel-mode-${mode}`);

  // Apply collapsed class to panels
  mixtapeTracksPanelEl.classList.toggle("is-collapsed", tracksCollapsed);
  mixtapeSearchPanelEl.classList.toggle("is-collapsed", searchCollapsed);

  // Update button chevrons (aria-expanded controls CSS flip)
  mixtapeCollapseBtns.forEach((btn) => {
    const panel = btn.getAttribute("data-panel");
    const expanded =
      panel === "tracks" ? !tracksCollapsed :
      panel === "search" ? !searchCollapsed :
      true;

    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
  });
}

function initMixtapeCollapseButtons() {
  if (!mixtapeCollapseBtns.length) return;

  mixtapeCollapseBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.getAttribute("data-panel");

      if (panel === "tracks") state.mixtape.ui.tracksCollapsed = !state.mixtape.ui.tracksCollapsed;
      if (panel === "search") state.mixtape.ui.searchCollapsed = !state.mixtape.ui.searchCollapsed;

      applyMixtapePanelLayout();
    });
  });
}

function renderMixtapeView() {
  ensureMixStore();
  renderMixPlaylistBar();
  renderMixSummary();
  mixtapeQueryEl.value = state.mixtape.lastQuery;
  renderMixtapeResults();
    applyMixtapePanelLayout();
}


// Call Spotify's /search endpoint and return the raw JSON result
async function fetchSpotifySearch(query) {
  // Make sure we have a valid Spotify token; this may trigger login
  const ok = await ensureSpotifyAccessToken("mixtape");
  if (!ok) {
    return {
      tracks: { items: [] },
      artists: { items: [] },
      albums: { items: [] },
    };
  }

  const params = new URLSearchParams({
    q: query,
    type: "track,artist,album",
    limit: "20",
  });

  const resp = await fetch(
    "https://api.spotify.com/v1/search?" + params.toString(),
    {
      headers: {
        Authorization: "Bearer " + spotifyAccessToken,
      },
    }
  );

  if (!resp.ok) {
  let errMsg = "";
  try {
    const errJson = await resp.json();
    errMsg = errJson?.error?.message ? `\n\nSpotify says: ${errJson.error.message}` : "";
  } catch (e) {
    // ignore
  }

  if (resp.status === 403) {
    alert(
      "Spotify search error (403)." +
        "\n\nYour Spotify account is not added to this app in the Spotify Developer Dashboard (Development Mode)." +
        "\nAsk Reagan to add your Spotify email, then re-login to Search and Mix." +
        errMsg
    );
  } else if (resp.status === 401) {
    alert(
      "Spotify session expired (401). Please re-login to Mix." +
        errMsg
    );
  } else {
    alert(
      "Spotify search error (" + resp.status + "). Please try again, or re-login to Mix." +
        errMsg
    );
  }

  return {
    tracks: { items: [] },
    artists: { items: [] },
    albums: { items: [] },
  };
}


  const data = await resp.json();
  // data has shape { tracks: {items: []}, artists: {items: []}, albums: {items: []} }
  return data;
}


function normalizeMixtapeResults(apiResult) {
  const results = [];

  // Track results: apiResult.tracks.items[]
  const trackItems =
    apiResult &&
    apiResult.tracks &&
    Array.isArray(apiResult.tracks.items)
      ? apiResult.tracks.items
      : [];

  trackItems.forEach((t) => {
    results.push({
      id: `track_${t.id}`,
      type: "track",
      title: t.name,
      subtitle: `${(t.artists || [])
        .map((a) => a.name)
        .join(", ")} • ${t.album ? t.album.name : ""}`,
      imageUrl:
        t.album &&
        t.album.images &&
        t.album.images.length
          ? t.album.images[t.album.images.length - 1].url
          : "",
      url: t.external_urls ? t.external_urls.spotify : "",
      uri: t.uri,
      durationMs: t.duration_ms || 0,
      previewUrl: t.preview_url || null,
    });
  });

  // Artist results: apiResult.artists.items[]
  const artistItems =
    apiResult &&
    apiResult.artists &&
    Array.isArray(apiResult.artists.items)
      ? apiResult.artists.items
      : [];

  artistItems.forEach((a) => {
    results.push({
      id: `artist_${a.id}`,
      type: "artist",
      title: a.name,
      subtitle: "Artist",
      imageUrl:
        a.images && a.images.length
          ? a.images[a.images.length - 1].url
          : "",
      url: a.external_urls ? a.external_urls.spotify : "",
    });
  });

  // Album results: apiResult.albums.items[]
  const albumItems =
    apiResult &&
    apiResult.albums &&
    Array.isArray(apiResult.albums.items)
      ? apiResult.albums.items
      : [];

  albumItems.forEach((al) => {
    results.push({
      id: `album_${al.id}`,
      type: "album",
      title: al.name,
      subtitle: `${(al.artists || [])
        .map((a) => a.name)
        .join(", ")} • Album`,
      imageUrl:
        al.images && al.images.length
          ? al.images[al.images.length - 1].url
          : "",
      url: al.external_urls ? al.external_urls.spotify : "",
    });
  });

  return results;
}


// ===== MIX EVENTS =====

if (mixtapeFormEl) {
  mixtapeFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = (mixtapeQueryEl.value || "").trim();
    if (!q) return;

    state.mixtape.lastQuery = q;

    try {
      const apiResult = await fetchSpotifySearch(q);
      state.mixtape.results = normalizeMixtapeResults(apiResult);
    } catch (err) {
      console.error("Mix Tape search error:", err);
      state.mixtape.results = [];
    }

    renderMixtapeResults();
  });
}

if (mixtapeClearBtn) {
  mixtapeClearBtn.addEventListener("click", () => {
    state.mixtape.results = [];
    state.mixtape.lastQuery = "";
    mixtapeQueryEl.value = "";
    stopPreview();
    renderMixtapeResults();
  });
}

if (mixtapeNavBackBtn) {
  mixtapeNavBackBtn.addEventListener("click", () => {
    // Force Album View to show the Mix Tape album (Country_12)
    const mixGenreIndex = GENRES.findIndex((g) => g.id === "country");
    if (mixGenreIndex !== -1) {
      state.genreIndex = mixGenreIndex;
      const mixAlbumIndex = GENRES[mixGenreIndex].albums.findIndex(
        (a) => a.baseId === "country-12" || a.baseId === "mix-tape"
      );
      if (mixAlbumIndex !== -1) {
        state.albumIndex = mixAlbumIndex;
      }
    }
    hapticTap();
    stopPreview();
    setView("album");
  });
}

// Playlist select
if (mixtapePlaylistSelectEl) {
  mixtapePlaylistSelectEl.addEventListener("change", () => {
    const store = getCurrentMixStore();
    store.currentPlaylistId = mixtapePlaylistSelectEl.value;
    saveMixStore(store);
    renderMixSummary();
    renderMixtapeResults();
  });
}

// New playlist
if (mixtapeNewPlaylistBtn) {
  mixtapeNewPlaylistBtn.addEventListener("click", () => {
    const store = getCurrentMixStore();
    if (store.playlists.length >= MAX_MIX_PLAYLISTS) {
      alert(
        `You’ve reached the maximum of ${MAX_MIX_PLAYLISTS} mixes. ` +
          "Delete one before creating a new mix."
      );
      return;
    }
    const name = prompt("Name for your new mix:", "New Mix");
    if (!name) return;
    const id = `mix-${Date.now()}`;
    store.playlists.push({
      id,
      name: name.trim(),
      createdAt: Date.now(),
      tracks: [],
    });
    store.currentPlaylistId = id;
    saveMixStore(store);
    renderMixPlaylistBar();
    renderMixSummary();
    renderMixtapeResults();
  });
}

// Rename playlist
if (mixtapeRenamePlaylistBtn) {
  mixtapeRenamePlaylistBtn.addEventListener("click", () => {
    const store = getCurrentMixStore();
    const pl = getCurrentPlaylist();
    if (!pl) return;
    const name = prompt("Rename mix:", pl.name);
    if (!name) return;
    pl.name = name.trim();
    saveMixStore(store);
    renderMixPlaylistBar();
    renderMixSummary();
  });
}

// Delete playlist
if (mixtapeDeletePlaylistBtn) {
  mixtapeDeletePlaylistBtn.addEventListener("click", () => {
    const store = getCurrentMixStore();
    const pl = getCurrentPlaylist();
    if (!pl) return;
    if (!confirm(`Delete mix “${pl.name}”?`)) return;

    store.playlists = store.playlists.filter(
      (p) => p.id !== pl.id
    );
    if (!store.playlists.length) {
      store.playlists.push({
        id: "mix-1",
        name: "My Mix",
        createdAt: Date.now(),
        tracks: [],
      });
    }
    store.currentPlaylistId = store.playlists[0].id;
    saveMixStore(store);
    renderMixPlaylistBar();
    renderMixSummary();
    renderMixtapeResults();
  });
}

// Save playlist to Spotify
if (mixtapeSavePlaylistBtn) {
  mixtapeSavePlaylistBtn.addEventListener("click", async () => {
    const store = getCurrentMixStore();
    const pl = getCurrentPlaylist();
    if (!pl || !pl.tracks.length) {
      alert("This mix has no tracks to save.");
      return;
    }

    // Make sure we're logged into Spotify
    const ok = await ensureSpotifyAccessToken("mixtape");
    if (!ok) return;

    // Ask for name; respect Cancel and blank strings
    const rawName = prompt(
      "Name for Spotify playlist:\n\nThis will add a new playlist to your Spotify account.",
      pl.name
    );

    // User hit CANCEL -> abort completely
    if (rawName === null) {
      return;
    }

    const newName = rawName.trim();
    if (!newName) {
      // Blank name -> do nothing
      return;
    }

    // 1. Get current user id
    const meResp = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: "Bearer " + spotifyAccessToken },
    });
    if (!meResp.ok) {
      console.error(
        "Spotify /me error:",
        meResp.status,
        await meResp.text()
      );
      alert("Could not fetch Spotify user profile.");
      return;
    }
    const me = await meResp.json();
    const userId = me.id;

    // 1b. Check for an existing playlist with the same name (first 50)
    try {
      const existingResp = await fetch(
        "https://api.spotify.com/v1/me/playlists?limit=50",
        {
          headers: { Authorization: "Bearer " + spotifyAccessToken },
        }
      );

      if (existingResp.ok) {
        const existingData = await existingResp.json();
        const items = existingData.items || [];
        const dup = items.find(
          (p) =>
            p.name &&
            p.name.toLowerCase() === newName.toLowerCase()
        );
        if (dup) {
          alert(
            `A Spotify playlist named “${newName}” already exists in your account.\n\n` +
              "Please choose a different name in Mix Tape before saving."
          );
          return;
        }
      }
    } catch (err) {
      console.warn("Error checking existing playlists:", err);
      // On error we just continue; user can still create the playlist
    }

    // 2. Create the new playlist
    const createResp = await fetch(
      `https://api.spotify.com/v1/users/${encodeURIComponent(
        userId
      )}/playlists`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + spotifyAccessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newName,
          description: "Created with Cassette Rack Mix",
          public: false,
        }),
      }
    );

    if (!createResp.ok) {
      console.error(
        "Spotify playlist create error:",
        createResp.status,
        await createResp.text()
      );
      alert("Could not create Spotify playlist.");
      return;
    }

    const playlistData = await createResp.json();
    const playlistId = playlistData.id;

    // 3. Add tracks in batches of up to 100 URIs
    const uris = pl.tracks.map((t) => t.uri).filter(Boolean);
    const batchSize = 100;

    for (let i = 0; i < uris.length; i += batchSize) {
      const batch = uris.slice(i, i + batchSize);
      const addResp = await fetch(
        `https://api.spotify.com/v1/playlists/${encodeURIComponent(
          playlistId
        )}/tracks`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + spotifyAccessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uris: batch }),
        }
      );

      if (!addResp.ok) {
        console.error(
          "Spotify add tracks error:",
          addResp.status,
          await addResp.text()
        );
        alert(
          "Playlist created, but adding some tracks failed."
        );
        return;
      }
    }

    alert("Mix saved to your Spotify account!");
    if (playlistData.external_urls?.spotify) {
      window.open(playlistData.external_urls.spotify, "_blank");
    }
  });
}


// Audio preview ended
if (mixtapeAudioEl) {
  mixtapeAudioEl.addEventListener("ended", () => {
    currentPreviewId = null;
    renderMixtapeResults();
  });
}

// ===== NAV / BUTTON WIRING =====

homeGenreButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.genreId;
    const index = GENRES.findIndex((g) => g.id === id);
    if (index >= 0) {
      state.genreIndex = index;
      state.albumIndex = 0;
      setView("genre");
    }
  });
});

genrePrevBtn.addEventListener("click", () => {
  hapticTap();
  if (state.genreIndex > 0) {
    state.genreIndex--;
    renderGenreShelf();
  }
});

genreNextBtn.addEventListener("click", () => {
  hapticTap();
  if (state.genreIndex < GENRES.length - 1) {
    state.genreIndex++;
    renderGenreShelf();
  }
});

genreBackBtn.addEventListener("click", () => {
  hapticTap();
  setView("home");
});

albumPrevBtn.addEventListener("click", () => {
  hapticTap();
  const albums = GENRES[state.genreIndex].albums;
  if (state.albumIndex > 0) {
    state.albumIndex--;
    updateAlbumOffset();
  }
});

albumNextBtn.addEventListener("click", () => {
  hapticTap();
  const albums = GENRES[state.genreIndex].albums;
  if (state.albumIndex < albums.length - 1) {
    state.albumIndex++;
    updateAlbumOffset();
  }
});

albumBackBtn.addEventListener("click", () => {
  hapticTap();
  setView("genre");
});

// Clicking main album stage
stageEl.addEventListener("click", () => {
  const album = getCurrentAlbum();
  if (!album) return;
  if (isMixTapeAlbum(album)) {
    (async () => {
      const ok = await ensureSpotifyAccessToken("mixtape");
      if (ok) setView("mixtape");
    })();
  } else {
    playCurrentAlbum();
  }
});


// ===== MENU + INTRO OVERLAYS =====
let APP_INTRO_TEXT = ""; // filled at very bottom for easy editing


function closeOverlay(overlayEl) {
  if (!overlayEl) return;

  // If closing the intro overlay, stop & reset the intro audio
  if (overlayEl.id === "intro-overlay") {
    stopAndHideIntroAudio();
  }

  overlayEl.classList.add("overlay-hidden");
  overlayEl.setAttribute("aria-hidden", "true");
}

function openOverlay(overlayEl) {
  if (!overlayEl) return;
  overlayEl.classList.remove("overlay-hidden");
  overlayEl.setAttribute("aria-hidden", "false");
}

function isOverlayOpen(overlayEl) {
  return overlayEl && !overlayEl.classList.contains("overlay-hidden");
}

function closeMenu() {
  const menu = document.getElementById("menu-overlay");
  closeOverlay(menu);
}

function openMenu() {
  const menu = document.getElementById("menu-overlay");
  openOverlay(menu);
}

function toggleMenu() {
  const menu = document.getElementById("menu-overlay");
  if (isOverlayOpen(menu)) closeMenu();
  else openMenu();
}

function showIntro() {
  closeMenu();
  const intro = document.getElementById("intro-overlay");
  const introBody = document.getElementById("intro-body");
  if (introBody) {
  const blocks = String(APP_INTRO_TEXT || "")
    .split(/\n\s*\n/g)
    .map(b => b.trim())
    .filter(Boolean);

  const html = blocks.map((block) => {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);

    const isList = lines.length > 1 && lines.every(l => /^[-•]\s+/.test(l));
    if (isList) {
      const items = lines.map(l => l.replace(/^[-•]\s+/, ""));
      return `<ul>${items.map(it => `<li>${escapeHtml(it)}</li>`).join("")}</ul>`;
    }

    // Not a list → normal paragraph (but preserve single line breaks if any)
    const safe = escapeHtml(block).replace(/\n/g, "<br>");
    return `<p>${safe}</p>`;
  }).join("");

  introBody.innerHTML = html;
}
  openOverlay(intro);
  showIntroAudioBar();
}

function showAddToHomeInstructions() {
  closeMenu();
  openOverlay(document.getElementById("addhome-overlay"));
}

function initMenuOverlays() {
  const menuToggle = document.getElementById("menu-toggle");
  const menuClose = document.getElementById("menu-close");
  const introClose = document.getElementById("intro-close");
  const addhomeClose = document.getElementById("addhome-close");

  const menuOverlay = document.getElementById("menu-overlay");
  const introOverlay = document.getElementById("intro-overlay");
  const addhomeOverlay = document.getElementById("addhome-overlay");

  if (menuToggle) {
    menuToggle.addEventListener("click", (e) => {
      e.preventDefault();
      toggleMenu();
    });
  }
  if (menuClose) menuClose.addEventListener("click", () => closeMenu());

  // Optional: tapping the dark backdrop closes overlays (but taps inside panel do not)
  [menuOverlay, introOverlay, addhomeOverlay].forEach((ov) => {
    if (!ov) return;
    ov.addEventListener("click", (e) => {
      if (e.target === ov) {
        if (ov.id === "intro-overlay" && window.__introAudio) window.__introAudio.hideBarAndStop();
        closeOverlay(ov);
      }
    });

  });

  if (introClose) introClose.addEventListener("click", () => {
    if (window.__introAudio) window.__introAudio.hideBarAndStop();
    closeOverlay(introOverlay);
  });

  if (addhomeClose) addhomeClose.addEventListener("click", () => closeOverlay(addhomeOverlay));

  // Menu actions
  const homeBtn = document.getElementById("menu-home");
  if (homeBtn) {
    homeBtn.addEventListener("click", () => {
      closeMenu();
      setView("home");
    });
  }

  document.querySelectorAll("[data-genre-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const gid = btn.getAttribute("data-genre-id");
      const idx = GENRES.findIndex((g) => g.id === gid);
      if (idx >= 0) {
        closeMenu();
        state.genreIndex = idx;
        state.albumIndex = 0;
        setView("genre");
      }
    });
  });

  const mixBtn = document.getElementById("menu-mixtape");
if (mixBtn) {
  mixBtn.addEventListener("click", async () => {
    closeMenu();
    hapticTap();
    const ok = await ensureSpotifyAccessToken("mixtape");
    if (ok) setView("mixtape");
  });
}

  const addHomeBtn = document.getElementById("menu-add-home");
  if (addHomeBtn) addHomeBtn.addEventListener("click", showAddToHomeInstructions);

  const introBtn = document.getElementById("menu-intro");
  if (introBtn) introBtn.addEventListener("click", showIntro);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


(async function init() {
  await spotifyHandleRedirectCallback();

  initMenuOverlays();
  initIntroAudioMiniPlayer();

  const desiredView = spotifyPostAuthView;
  sessionStorage.removeItem("spotify_post_auth_view");

  renderHomeShelf();

  initMixtapeCollapseButtons();

  if (desiredView === "mixtape") {
    setView("mixtape");
  } else {
    setView("home");
  }
})();


// =============================
// INTRO AUDIO MINI PLAYER (Option A)
// =============================
const INTRO_AUDIO_SOURCES = {
  app: "App-Intro.mp3",
  challenges: "Mix-Challenges.mp3",
};

let introAudioRefs = null;
let introAudioActiveKey = "app";

function initIntroAudioMiniPlayer() {
  const bar = document.getElementById("intro-audio-bar");
  const audio = document.getElementById("intro-audio");

  const tabApp = document.getElementById("intro-audio-tab-app");
  const tabChallenges = document.getElementById("intro-audio-tab-challenges");

  const btnPlay = document.getElementById("intro-audio-play");
  const btnRewind = document.getElementById("intro-audio-rewind");
  const btnClose = document.getElementById("intro-audio-close");

  if (!bar || !audio || !tabApp || !tabChallenges || !btnPlay || !btnRewind || !btnClose) {
    console.warn("Intro audio player elements not found. Check index.html IDs.");
    return;
  }

  introAudioRefs = { bar, audio, tabApp, tabChallenges, btnPlay, btnRewind, btnClose };

  function setActiveTab(key) {
    introAudioActiveKey = key;

    tabApp.classList.toggle("is-active", key === "app");
    tabChallenges.classList.toggle("is-active", key === "challenges");

    // Load the selected audio (do NOT autoplay)
    audio.src = INTRO_AUDIO_SOURCES[key];
    audio.load();

    // Reset button label
    btnPlay.textContent = "Play";
  }

  function updatePlayLabel() {
    btnPlay.textContent = audio.paused ? "Play" : "Pause";
  }

  tabApp.addEventListener("click", () => {
    showIntroAudioBar();
    setActiveTab("app");
  });

  tabChallenges.addEventListener("click", () => {
    showIntroAudioBar();
    setActiveTab("challenges");
  });

  btnPlay.addEventListener("click", async () => {
    showIntroAudioBar();
    if (!audio.src) {
      setActiveTab(introAudioActiveKey);
    }

    try {
      if (audio.paused) {
        await audio.play(); // user-initiated -> allowed
      } else {
        audio.pause();
      }
      updatePlayLabel();
    } catch (err) {
      console.warn("Intro audio play failed:", err);
      alert("Audio couldn’t play. Try again.");
    }
  });

  btnRewind.addEventListener("click", () => {
    if (!audio.src) return;
    audio.currentTime = 0;
  });

  btnClose.addEventListener("click", () => {
    stopAndHideIntroAudio();
  });

  audio.addEventListener("play", updatePlayLabel);
  audio.addEventListener("pause", updatePlayLabel);
  audio.addEventListener("ended", updatePlayLabel);

  // Default selection (no autoplay)
  setActiveTab("app");
}

function showIntroAudioBar() {
  if (!introAudioRefs) return;
  introAudioRefs.bar.classList.remove("intro-audio-bar--hidden");
}

function stopAndHideIntroAudio() {
  if (!introAudioRefs) return;

  const { bar, audio, btnPlay } = introAudioRefs;

  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (_) {}

  btnPlay.textContent = "Play";
  bar.classList.add("intro-audio-bar--hidden");
}



// ===== APP INTRO TEXT (edit me) =====
APP_INTRO_TEXT = `
Before algorithms decided what song we should hear next, we made mix tapes. Carefully chosen songs. Perfect timing. And the order mattered. Side “A” had to start strong… and side “B” said something only the right person would understand.

You didn’t just give someone music, you gave them a story. They weren’t random, they were intentional (a hint, a confession, a memory, a hope). They were specifically crafted:

-	For friends you wanted to hype up
-	For road trips that needed the perfect soundtrack
-	For parties where the vibe couldn’t be trusted to chance
-	For love interests, where the tracks said more than words ever could

For those who know, mix tapes weren’t just created… they were earned. This was serious business and we took pride in it. We obsessed over every detail, we dedicated endless hours, and we fought through some laughably challenging obstacles. Maybe that’s why it still means so much.

-	Nothing was instant, we did it live, in real time. A three-minute song took three minutes to record. We waited days for the right song… if we missed it, we waited some more.
-	Timing was everything… and unforgiving. You don’t know anxiety until you hover over the RECORD button to get that last track. We didn’t guess, we anticipated.
-	Cassette space was not unlimited. We calculated song lengths to maximize each side and planned the sequence like a complex puzzle. No dead space, no tracks cut short, and only clean transitions.
-	Mistakes were brutal, there was no “undo”. DJ talking. A door slam. Ghosts of old recordings bleeding through. Mom yelling from another room. We started over.
-	We worked with the tools we had. No dual cassette deck? No problem - we would just put two jamboxes next to each other. For live recordings, we barricaded our rooms and sat in silence.
-	This stuff was manual and it didn’t always work. Batteries died… Tapes were eaten… And when that happened, we executed the sacred pencil rewind with surgeon-level precision.
-	There was no internet or influencers. We actually listened to music and researched trends, hot artists, and new releases. Access was limited, so Casey Kasem’s Top 40 was prime time for mixing. 
-	Giving someone a mix tape felt vulnerable - like handing over a piece of yourself. Even the labels and track lists were a big deal. They were hand-written, and rewritten until it looked effortlessly cool. Cross-outs were shameful and white-out was an admission of defeat.


So… welcome back to the mix tape era. This app is a love letter to everyone who remembers and wants to experience it again.

-	A cassette rack you browse by genre
-	Albums you pull from the shelf like you used to
-	And a dedicated Mix Tape where you build something personal, intentional, and meaningful

But now, instead of sitting by the radio, you’re crafting mixes with the full power of Spotify — without losing the soul of the experience.

-	Create multiple mix tapes
-	Search songs, artists, and albums using Spotify’s catalog
-	Add, reorder, and remove tracks until it feels just right
-	And when it’s done, your mix becomes a real Spotify playlist — ready to listen to, revisit, and share.

If you grew up in the cassette era, this will feel instantly familiar - like coming home. If you didn’t, this is your chance to experience why mix tapes were such a big deal. The best ones had a name. They had a mood. They had a reason.

It’s time to make a mix tape again.`.trim();