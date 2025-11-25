# SDK Doctor Test Examples

## Test Files

### test-time-based-detection.html

Tests SDK Doctor's ability to detect outdated SDK versions using time-based logic across all supported SDKs (Web, Python, Node.js, React Native, Flutter, iOS, Android, Go, PHP, Ruby, Elixir, .NET).

- Fetches current release/version info from GitHub
- Sends events to tests "Current", "Close enough", and "Outdated" detection

### test-feature-flag-misconfiguration.html

Sends events to tests SDK Doctor's ability to detect feature flags called events captured prior to any other events in the same session

- Tests flags called before any other events (problematic)
- Tests multiple flags before any other events (problematic)
- Tests proper flag usage after any other events (correct)
- Does not alert for bootstrapped flags

## Usage

1. **Configure your PostHog API key:**

    - Open the HTML file in a text editor
    - Find the `API_KEY` constant near the top of the `<script>` section
    - Replace `'YOUR_POSTHOG_PROJECT_KEY'` with your PostHog project API key (`phc_...`)
    - Update the `HOST` value with your PostHog instance URL (e.g., `http://localhost:8010`)

2. **Open the HTML file** in your web browser (Chrome, Firefox, Safari, etc.)

3. **Run tests:**
    - Click any test button to simulate different scenarios
    - Watch the log output for event details
    - Open your PostHog instance's activity page to see the events sent.

## Requirements

- A text editor
- A web browser (no build tools or dependencies needed)
- A PostHog instance (local/dev or self-hosted)
- A PostHog project API key
- A tolerance for vibe-coded stuff

## Development

These are basic, standalone HTML files with embedded CSS and JavaScript. To modify:

1. Open the HTML file in your favorite text editor (or your least favorite, if you're in the mood for a challenge)
2. Make changes to the HTML, CSS, or JavaScript
3. Refresh in browser to test. No build step needed.
