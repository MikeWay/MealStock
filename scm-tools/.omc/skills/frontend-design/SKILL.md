---
name: frontend-design
description: UI/UX design patterns for the SCM Tools dashboard (vanilla JS, HTML/CSS, no framework)
triggers:
  - frontend
  - dashboard
  - ui
  - design
  - html
  - css
  - button
  - section
  - form
argument-hint: "<component-description>"
---

# Frontend Design Skill

## Purpose

Apply consistent UI patterns to the SCM Tools dashboard. The dashboard is a single `src/public/index.html` file using vanilla JS with no frontend framework.

## Stack

- **No framework** — plain HTML, CSS, inline `<style>`, and a single `<script>` block
- **Bootstrap-inspired colour palette** but no Bootstrap dependency
- **Section-based layout** — each feature is a hidden `<div>` shown/hidden by a nav button

## UI Patterns

### Nav buttons

All feature entry points are `<button class="nav-link">` elements in the button bar. Colour conventions:

| Colour | Hex | Used for |
|--------|-----|---------|
| Default blue | `#007bff` | General actions |
| Red | `#dc3545` | Destructive / cache-clear |
| Orange | `#e67e00` | Warning / fix actions |
| Purple | `#6f42c1` | Minutes / upload |
| Teal | `#17a2b8` | Consents |
| Dark grey | `#495057` | Admin / settings |

Button spacing: `style="margin-left: 0.5rem;"` between siblings.

### Sections

Each feature section follows this pattern:

```html
<div id="<feature>-section" style="display:none;">
  <h2 style="margin-bottom:0.75rem;">Feature Name</h2>
  <!-- content -->
</div>
```

Sections are shown/hidden in JS:
```js
featureBtn.addEventListener("click", function() {
  featureSection.style.display = "block";
  // load data...
});
```

Sections that toggle (show/hide on repeat click):
```js
section.style.display = section.style.display === "none" ? "block" : "none";
```

### Forms

```html
<form id="<name>-form" style="max-width:360px;">
  <label for="<id>">Label</label>
  <input type="..." id="<id>" required style="margin-bottom:0.5rem;">
  <button type="submit" class="nav-link" style="margin-top:0;">Action</button>
  <div id="<name>-msg"></div>  <!-- feedback text -->
</form>
```

### Status / feedback messages

Use a `<div id="...-msg">` or `<div id="...-error">` with `.textContent` for inline feedback. Never use `alert()` for non-destructive messages.

### Confirm before destructive action

```js
if (!confirm("Are you sure?")) return;
```

### Loading state

```js
el.textContent = "Loading…";
// or
btn.disabled = true;
btn.textContent = "Working…";
```

### Tables

```html
<table style="border-collapse:collapse;width:100%;max-width:600px;">
  <thead><tr>
    <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #dee2e6;">Col</th>
  </tr></thead>
  <tbody>...</tbody>
</table>
```

## API call pattern (vanilla JS)

```js
fetch("/api/endpoint", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: value })
})
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.success) { /* handle success */ }
    else { msgEl.textContent = data.message || "Failed"; }
  })
  .catch(function() { msgEl.textContent = "Network error"; });
```

## SSE (Server-Sent Events) pattern

Used for long-running scans (consents, email issues):

```js
var es = new EventSource("/api/feature/progress");
es.onmessage = function(e) {
  var d = JSON.parse(e.data);
  if (d.complete) { es.close(); /* refresh */ }
  if (d.isError) { es.close(); /* show error */ }
  /* update progress bar */
};
es.onerror = function() { es.close(); };
```

## Session / auth flow

- On page load: `fetch("/api/auth/status")` → show login or dashboard
- Login posts `{ email, password }` to `/api/auth/login`
- If `noUsersExist`, show bootstrap form instead of login form
- All protected API calls return `401` if not authenticated → redirect to login

## Notes

- All sections start hidden (`style="display:none;"`) and are revealed on demand
- `showDashboard()` / `showLogin()` helper functions toggle top-level sections
- `window.deleteUser` etc. are global helpers called from inline `onclick` in dynamic table HTML
- Avoid inline event handlers in static HTML; use `addEventListener` instead
