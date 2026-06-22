# Pressure Flyer

A small side-scroller game controlled by an Arduino force sensitive resistor.

## Run

Serve the folder from localhost, then open the page in Chrome or Edge:

```powershell
python -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

Web Serial requires a browser permission prompt, so after typing a COM port and clicking `Connect`, select the Arduino device in the browser dialog.

## Arduino signal format

Print one of these values repeatedly over serial at `9600` baud:

```text
0
1
2
```

`0` means no press, `1` means small press, and `2` means the larger squeeze used to clear trees.

For quick keyboard testing without Arduino, press `1` about once per second to stay at the middle baseline and press `2` when a tree approaches.

## Game results

When a game ends, the browser posts this JSON to Firebase:

```json
{
  "teamNumber": "12",
  "score": 42,
  "createdAt": "2026-06-22T00:00:00.000Z"
}
```

If the game says `Failed to save result`, check the browser console first. The usual causes are:

- Firebase Realtime Database rules are rejecting unauthenticated writes. For a classroom/demo setup, allow writes to `game_results`, then tighten the rule later.
- The database URL is wrong or missing `.json` at the end. Realtime Database REST writes require the `.json` suffix.
- The computer is offline, a school network blocks Firebase, or a browser extension blocks the request.
- The Firebase project is using a different Realtime Database instance or region than the URL in `game.js`.

For a quick demo-only fix, use Firebase Console > Realtime Database > Rules and publish a rule like this:

```json
{
  "rules": {
    "game_results": {
      ".read": false,
      ".write": true,
      ".validate": "newData.hasChildren(['teamNumber', 'score', 'createdAt']) && newData.child('teamNumber').isString() && newData.child('score').isNumber() && newData.child('createdAt').isString()"
    }
  }
}
```

This allows anyone with the database URL to write results, so do not leave it open for a public deployment. For production, put the Firebase write behind a small backend or add Firebase Authentication and write rules that only allow signed-in game clients.
