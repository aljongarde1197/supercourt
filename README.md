# SUPER COURT — v12 (Offline, Same-Wi-Fi Open Play)

## Start the game

Requires Node.js 18+ on the hosting computer. In the `courtside_lan` folder:

```bash
npm install
npm start
```

Host: `http://localhost:3000`. Other devices on the same Wi-Fi can open the local network address printed by `npm start` and select **JOIN WI-FI MATCH**.

## Changes in v12

- **Hard/Pro returns:** In offline mode, Hard and Pro begin reading the incoming serve's projected landing point while the ball is still in the air, anticipating wide corners. Ball-contact reach was adjusted for those levels. They still must let the serve bounce before returning.
- **Correct kitchen-fault zoom:** The animation now focuses on the actual player or AI partner who committed the kitchen/momentum fault when that character is known.
- **Performance:** Lower default pixel density and shadow resolution, fewer auxiliary rendering callbacks, hidden-tab throttling, 12 Hz LAN state updates with client-side smoothing, and low-frequency previews for waiting players.
- **Open Play queue:** Custom room name, session duration (1–8 hours from the lobby), visible roster and queue, current match/score/shot count, and a live 2D court preview for queued users.
- **Random rotation:** The next waiting opponent is selected randomly after each finished match instead of always using FIFO. The host remains the authoritative player for the room.
- **Chat:** All room members (including queued users) can chat; messages are length-limited and rendered as text, and the server enforces a 2.2-second cooldown and five messages per 20 seconds. Recent chat history is retained in memory, up to 30 messages.
- **Room capacity:** Up to 12 human connections per room, counting the host, one active guest and up to ten queued members. A room is also limited by its scheduled end time. A match already in progress can finish when its time runs out.
- **Doubles filling:** The existing doubles match still has two human-controlled players and **two AI partners**, filling the four on-court slots. This version **does not** allow four humans to control four athletes simultaneously. A room can have 12 human attendees, but one host and one guest are the active human players.

## How to use Open Play

1. The host chooses a room name and a session duration, then chooses **HOST WI-FI MATCH**.
2. Other players open the same LAN server URL, choose **JOIN WI-FI MATCH**, and select a room or enter its code.
3. The **OPEN PLAY · LOBBY / CHAT** panel displays session time remaining, current match score, a small live match preview, a queue roster, and chat.
4. Once a match ends, a random queued player becomes the next guest. The host starts the next match.
5. **Singles** uses the host and one opponent. **Doubles** uses those two players plus AI teammates. If you need four-human doubles, that requires a separate four-player networking and rule-processing implementation.

## Networking and hosting

The host browser is authoritative for ball physics and scoring. The Node server relays game state and coordinates room membership, chat, and queue rotation. A LAN-only IP check rejects public clients: this is intentionally **not** an internet-hostable build without server changes.

**Vercel:** WebSocket Functions are supported as of late 2026, but deploying this folder unchanged won't produce a scalable public multiplayer game. Vercel Functions may place reconnecting clients on different instances, so multiplayer rooms require durable shared state (e.g., Redis) and a Vercel-compatible WebSocket deployment. Consider Vercel for the static browser frontend and a managed regional realtime backend for matches. Hosting does not improve client GPU rendering. For same-Wi-Fi play, a local server generally provides lower latency than a distant cloud backend.

## Verification

- `node --check` passed for `server.js` and extracted frontend JavaScript.
- A mocked WebSocket integration test passed for custom rooms, 12-seat capacity, chat rate limits, spectator summaries, doubles AI slots, and random promotion.
- A complete 3D browser playthrough and two-device LAN match were not run: `npm install --offline` failed because `three` was not cached in the build environment.
# supercourt
