# Contact Merge

This document describes how duplicate contact detection and merging works in SCM Tools.

---

## Overview

SCM Tools can detect contacts in the SCM system that appear to represent the same person, and can merge them through SCM's own merge facility. The merge is performed by automating the SCM web interface — SCM has no API for this.

---

## Finding Duplicates

Clicking **Duplicate Contacts** in the dashboard exports all contacts from SCM (cached for the day), then runs a duplicate-detection algorithm locally.

### Detection algorithm

Two contacts are considered candidate duplicates if their **last name** is at least 85% similar and their **first name** is at least 70% similar, measured by the [Sørensen–Dice coefficient](https://en.wikipedia.org/wiki/S%C3%B8rensen%E2%80%93Dice_coefficient) on character bigrams. Similarity is assessed on normalised names (lower-case, punctuation removed).

Contacts tagged **"Non Duplicate"** are excluded from detection entirely.

Candidate pairs are grouped transitively: if A matches B and B matches C, all three appear in the same group.

### Definite vs Possible duplicates

Within each group, the system checks for stronger evidence:

| Evidence | Classification |
|---|---|
| Same email address | **Definite** |
| Same phone number (normalised) | **Definite** |
| One contact has no contact info at all | **Definite** |
| No strong evidence beyond name similarity | **Possible** |

Contacts with differing dates of birth are never considered a **Definite** pair.

Definite duplicate groups are shown first and are the ones for which the **Merge** workflow is offered.

---

## Merge Workflow

Merging is only available for **Definite** duplicate groups of exactly two contacts. The process has four steps.

### Step 1 — Choose primary and secondary

The contact displayed as **Primary** is the one that will survive the merge. The **Secondary** contact will be removed.

SCM Tools defaults to showing the first contact as primary. Use the **⇄ Swap** button to reverse this if needed.

**Guidelines for choosing primary:**
- Prefer the contact with an active membership.
- If neither or both have active memberships, prefer the older record (usually the lower contact ID or the one with more data).

The contact's **Tags** are shown in the table to help identify membership status.

### Step 2 — Preview Merge

Click **Preview Merge**. SCM Tools navigates to SCM's merge page, submits the selected primary and secondary, and retrieves SCM's own merge preview.

The preview shows a table of all fields with four columns:

| Column | Meaning |
|---|---|
| Field | The name of the data field |
| Primary value | What the primary contact currently holds |
| Merged result | What SCM will store after the merge |
| Secondary value | What the secondary contact currently holds |

Rows highlighted in red with **"not merged"** indicate that the secondary has a value in a single-value field where the primary also has a (different) value. SCM will keep the primary's value and discard the secondary's. This is expected behaviour — see [How SCM merges data](#how-scm-merges-data) below.

Any warning message returned by SCM (e.g. "It looks like there is an internal issue with contact merging") is shown in amber. These warnings are usually safe to ignore; the key indicator of whether the merge can proceed is whether SCM's page presents a **Merge now** button. If it does, **Confirm Merge** is available. If it does not, the merge cannot proceed.

### Step 3 — Pre-merge logon check

Before confirming, check whether both contacts have SCM logon accounts:

1. Open each contact in SCM (links are provided in the Name column).
2. Look at the **Last logged in** date on each contact's logon record.
3. If both have logons, disable or delete the one that is less recent (typically the newer/secondary one). A user with a forgotten password should use **Forgot password**, not create a duplicate account.

> **Why this matters:** SCM cannot merge two contacts that both have active logon accounts. Disabling one before merging avoids an error.

### Step 4 — Confirm and tidy up

Click **Confirm Merge**. SCM Tools re-runs the preview on SCM's page and then clicks **Merge now**.

After a successful merge:
- The secondary contact's row is removed from the duplicates list.
- A reminder is shown to **check the merged contact for duplicate addresses, emails, and phone numbers**. SCM combines multi-value fields from both contacts, which can introduce duplicates (e.g. the same address listed twice).

---

## How SCM Merges Data

SCM applies two rules depending on the field type:

| Field type | Merge rule |
|---|---|
| **Single-value** (e.g. name, date of birth, logon email) | Primary value is kept. Secondary value is used only if the primary field is empty (strictly — a zero-length string is still considered empty, but a field that was never set may not be). |
| **Multi-value** (e.g. email addresses, phone numbers, postal addresses, bookings, memberships) | Lists from primary and secondary are combined into a single list on the resulting contact. |

This means the preview's **"not merged"** flags on single-value rows are not errors — they reflect SCM correctly preferring the primary's data.

---

## Technical Notes

- Contact data is exported from SCM as a CSV and cached locally for the current day. Use **Clear Cache** to force a fresh export.
- The merge automation uses Playwright to control a real browser session. The logged-in SCM session of the dashboard user is used.
- The preview and the actual merge both navigate SCM's `/contacts/{id}/merge` page. The preview is re-run at confirm time to ensure the browser is on the correct page state before clicking **Merge now**.
- Error detection: only the absence of a **Merge now** button on SCM's preview page is treated as a hard block. All other alerts are surfaced as warnings for the user to assess.
