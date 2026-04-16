# LinkedIn Outreach Automation — User Guide

A step-by-step guide for getting started, from install to your first outreach run.

---

## What this app does

You describe who you want to connect with on LinkedIn. The app finds people, writes a personalized connection note, and sends invites — one at a time, with human-like delays. You stay in control: you can stop anytime, review messages before they send, and see exactly what happened.

---

## What you need

- A Mac (macOS) computer
- Google Chrome browser
- A LinkedIn account (logged in on Chrome)
- The LinkedIn Outreach Automation desktop app (this app)

Optional but recommended:
- A **Bearer token** for your local Grok proxy (`/chat/completions`), or environment variable `LOA_LLM_API_KEY`, for personalized messages. Without one, the app uses your templates exactly as written.

---

## Step 1: Install the desktop app

1. Open the folder where you downloaded the app.
2. Find the file called **LinkedIn Outreach Automation.app** (in the `release/mac-arm64/` folder).
3. Drag it to your **Applications** folder — or just double-click it to run.
4. If macOS says "the app is from an unidentified developer":
   - Go to **System Settings → Privacy & Security**.
   - Scroll down and click **Open Anyway** next to the app name.

The app window should open with a step indicator showing "Connect" as the first step.

---

## Step 2: Install the Chrome extension

The app needs a Chrome extension to interact with LinkedIn. It only runs on linkedin.com — never on other sites.

### First-time setup (takes ~60 seconds)

1. **Open the extension folder.** In the LinkinReachly app, click the **Open folder** button (during onboarding, or later in the Connect step). A Finder window opens showing the extension files. **Leave this Finder window open** — you'll need it in step 4.

2. **Open the Chrome extensions page.** In Chrome, type `chrome://extensions` in the address bar and press Enter. (You cannot click a link to get there — Chrome requires you to type it.)

3. **Turn on Developer mode.** Look for the **Developer mode** toggle in the **top-right corner** of the extensions page. Click it so it turns blue/on. You'll see new buttons appear: "Load unpacked", "Pack extension", and "Update".

4. **Load the extension.** Click the **Load unpacked** button (top-left area). A file picker opens. Navigate to the folder from step 1 (the Finder window you left open), select it, and click **Select** (macOS) or **Select Folder** (Windows). You should now see **LinkinReachly** in your extensions list with a toggle showing it's enabled.

5. **Pin the extension (recommended).** Click the puzzle-piece icon in Chrome's toolbar (top-right, next to the address bar). Find **LinkinReachly** in the dropdown and click the **pin icon** so it stays visible in your toolbar.

### Verify it's working

The extension badge (on the toolbar icon) tells you the connection status:
- **ON** (green) = connected to the desktop app and ready
- **WAIT** (amber) = looking for the desktop app — make sure LinkinReachly is running
- **STOP** (red) = paused — click the icon once to reconnect

### Common issues

| Problem | Fix |
|---------|-----|
| "Load unpacked" button doesn't appear | Developer mode is off. Toggle it on (step 3). |
| Extension loads but badge is blank | Click the extension icon once to activate it. |
| Badge says WAIT | Make sure the LinkinReachly desktop app is open and running. |
| Badge stays WAIT after opening the app | Go to `chrome://extensions`, click the reload arrow (↻) on LinkinReachly, then refresh your LinkedIn tab. |
| Chrome says "This extension may have been corrupted" | Remove the extension, then repeat steps 4-5 with the same folder. |

### After app updates

When LinkinReachly updates, the extension files update too. If the app shows an "Extension outdated" message:
1. Go to `chrome://extensions`.
2. Find **LinkinReachly** and click the reload arrow (↻).
3. Refresh any open LinkedIn tabs.

---

## Step 3: Open LinkedIn in Chrome

1. Go to **linkedin.com** in Chrome. Make sure you're logged in.
2. Keep this tab open and focused.
3. Check the extension badge — it should say **ON** (green).
4. In the desktop app, the status should change to **Chrome ready** (green pill in the header).

If it still says "Extension offline" or "Open LinkedIn tab":
- Make sure the LinkedIn tab is the active/focused tab in Chrome.
- Click **Check connection** in the app header.
- Try clicking the extension icon in Chrome to toggle it off (STOP) then on again (ON).

---

## Step 4: Describe your goal

Now the app moves to the **Goal** step automatically.

1. In the text box labeled **Your goal**, describe who you want to reach. Write it like you'd tell a colleague:
   - "Connect with hedge fund hiring managers looking for junior talent"
   - "Reach out to VCs who invest in AI startups"
   - "Connect with marketing directors at SaaS companies"
2. Pick an **Outreach type** from the dropdown (usually "Generic connection" works).
3. Click **Go**.

The app will:
- Build a plan (what to search, what to say)
- Navigate Chrome to LinkedIn search
- Find matching people
- Start sending connection invites with personalized notes

If you want more control, click **Plan only** instead of Go. This builds the plan without starting the run, so you can review everything first.

---

## Step 5: Review your message (optional)

If you clicked **Plan only** in the previous step, you'll see the plan results with a **Next: review message** button.

1. Click **Next: review message**.
2. You'll see your connection note template. Edit it if you want.
3. Use the **Insert** buttons to add personalization: first name, company, headline.
4. Click **Preview message** to see what a real message would look like.
5. When you're happy, click **Next: find people and send**.

---

## Step 6: Find people and send

1. Click **Find people from plan** — the app will search LinkedIn and fill in the list.
2. You'll see how many people were found (e.g., "25 people ready").
3. Alternatively, you can paste LinkedIn profile URLs directly into the text box.
4. Click **Start run**.

The app sends connection invites one at a time:
- It navigates to each profile in Chrome
- Clicks the Connect button
- Adds your personalized note
- Waits 45–90 seconds between people (to look natural)
- Takes breaks every 5–8 sends

You can watch the progress bar and click **Stop** anytime.

---

## Step 7: Check results

When the run finishes, you'll see:
- How many invites were sent
- Any errors (e.g., someone was already connected)
- The last status message

Click **View full history** to see every outreach attempt, or **Export log** to save a file.

To start a new campaign, click **Start a new campaign**.

---

## Settings

Click **Settings** in the top-right corner of the app to configure:

### AI composition (optional)
- **Let AI write personalized messages**: Turn this on to get AI-written messages instead of template fill-ins.
- **Grok proxy details**: **Server URL** (proxy base URL, default `http://127.0.0.1:8000`) and **Model** (default `grok-4.1-fast`).
- **Bearer token**: Sent as `Authorization: Bearer …` to your proxy. Stored encrypted on your computer when possible. You can also set `LOA_LLM_API_KEY` when launching the app instead of saving a token in Settings.

### Speed and limits
- **Max invites per day**: Default is 20. LinkedIn may flag accounts that send too many.
- **Delay between people**: How long to wait between each invite (default 45–90 seconds).

Click **Save** after making changes.

### Jobs: two ways to move on Easy Apply cards

The desktop app can treat **Easy Apply** in two different ways. Both are valid; the difference is when automation starts.

| Surface | What happens when you approve |
|--------|------------------------------|
| **Simple Apply** (main Apply flow) | The job is **added to the apply queue**. You start the queue when you are ready. Good when you want to batch and review the list first. |
| **Swipe / card stack** (alternate simple UI) | The app calls **Easy Apply immediately** for that card (same engine as the queue, but no enqueue step). Good for one-at-a-time review. |

If something "did not run" when you expected it to, check which UI you used: queue items need **Start applying**; swipe mode runs as soon as you swipe to approve.

---

## History

Click **History** in the top-right to see all past activity:
- Green checkmark = sent successfully
- Red X = error (could not connect)
- Arrow = skipped (already connected, duplicate, etc.)

Click **Export JSONL** to save the full log file.

---

## Troubleshooting

### "Extension offline" — the app can't find the Chrome extension
- Make sure the extension is installed (Step 2).
- Go to `chrome://extensions` and check that it's enabled.
- Click the extension icon to make sure it says ON.
- If the badge is blank, click the icon once to toggle it.

### "Open LinkedIn tab" — extension is connected but LinkedIn isn't focused
- Switch to a linkedin.com tab in Chrome.
- Make sure you're logged into LinkedIn.

### The extension badge is blank or says WAIT
- The desktop app might not be running. Open it.
- If the app is running, click **Check connection** in the header.
- Try reloading the extension at `chrome://extensions` (click the circular arrow).

### Messages sound robotic
- Add an AI API key in Settings for personalized messages.
- Edit your templates to sound more like you.

### "Daily cap reached"
- The app stops after 20 invites per day by default. Increase in Settings if needed.
- Wait until tomorrow for the counter to reset.

### LinkedIn shows a warning or rate limit
- The app detects LinkedIn error toasts and stops automatically.
- Wait a few hours before trying again.
- Keep delays at the default 45–90 seconds.

---

## Safety notes

- The app uses conservative delays (45–90 seconds between invites) to avoid triggering LinkedIn's anti-automation detection.
- It takes automatic breaks every 5–8 sends.
- All activity is logged — you can always see exactly what was sent.
- The connection invite note limit is 300 characters (LinkedIn's limit).
- The app never sends anything without you pressing **Go** or **Start run** first.
- Your API key stays on your computer. It's only sent to the AI provider you configure.
