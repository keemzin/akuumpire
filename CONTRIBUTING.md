# Contributing to ShuttleLive

Thank you for your interest in contributing to **ShuttleLive**! ShuttleLive is an open, frictionless, real-time badminton scoreboard designed to be accessible to anyone without forced account registration.

---

## 🚀 Getting Started

1. **Fork & Clone** the repository:
   ```bash
   git clone https://github.com/<your-username>/shuttlelive.git
   cd shuttlelive
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```
   Open your browser at `http://localhost:3000`.

4. **Run Automated Tests**:
   ```bash
   npm test
   ```

---

## 🌿 Branch & Commit Guidelines

- **Branch Naming**:
  - `feat/add-sound-effects`
  - `fix/doubles-rotation-odd-score`
  - `docs/update-readme`
- **Conventional Commits**:
  - `feat: add quick deuce indicator badge`
  - `fix: resolve court side swap after set 2`
  - `test: add unit tests for 30-point golden point cap`

---

## 🛠️ Code Structure

```
shuttlelive/
├── server/
│   ├── server.js               # Express + Socket.io entry point
│   ├── rules/
│   │   └── badmintonRules.js   # BWF scoring logic & rotation calculations
│   └── models/
│       └── matchStore.js       # Match state storage & JSON disk persistence
├── public/
│   ├── index.html              # Landing page (live match viewer)
│   ├── admin.html              # Match creation & PIN generator
│   ├── match.html              # High-contrast live spectator/TV scoreboard
│   ├── umpire.html             # Mobile/tablet touch scoring console
│   ├── css/                    # Modular CSS design system
│   └── js/                     # Client scripts & WebSocket sync
└── tests/
    └── badmintonRules.test.js  # Node.js automated test suite
```

---

## 🤝 Submitting a Pull Request (PR)

1. Ensure all tests pass (`npm test`).
2. Keep PRs focused on a single feature or bugfix.
3. Open a PR against `main` with a clear description and screenshot if UI changes were made.
