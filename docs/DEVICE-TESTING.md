# Devices — what was checked, what was fixed, what still needs you

## What "works on all devices" can and cannot be proved here

Twelve responsive checks run automatically (`node tools/responsive.js`). They
read the stylesheets and the pages and prove things like: no element is pinned
to a width a phone does not have, every wide table can scroll inside its own
box, every tap target reaches 44 pixels, no form field is small enough to make
iPhones zoom.

They cannot prove the homepage *looks right* on a Galaxy A14, because nothing
short of a Galaxy A14 can. The manual list at the bottom is short and worth an
hour.

---

## What was wrong, and is now fixed

**The control centre was close to unusable on a phone.** Twenty-two navigation
buttons stacked vertically, so reaching any content meant scrolling past the
entire menu. The rail is now a strip across the top that scrolls sideways and
stays put while you work.

**Tables dragged the whole page sideways.** A six-column invoice table on a
360-pixel screen made every page scroll horizontally — the layout equivalent of
a dropped call. Tables now scroll inside their own box; the page does not move.

**Tapping any field zoomed the page on iPhones.** Safari zooms when it meets an
input smaller than 16 pixels, and the control centre used 14. Now 16 wherever
the pointer is a finger, unchanged on a desktop.

**The section menu stacked into four lines.** On a narrow screen the navigation
wrapped and pushed the first headline below the fold. It now scrolls sideways as
one line, on the public site, the portal and the control centre alike.

**The page did not use the whole screen.** Gutters were a fixed 20 pixels at
every size, and the content stopped at 1180 pixels however large the monitor.
Gutters now shrink on a phone and grow on a desktop, and the ceiling rises to
1360 and then 1560 pixels on large screens. Article text keeps its reading
measure deliberately — a line of prose 200 characters wide is not an
improvement, it is an obstacle.

**Notched phones lost edges.** Pages now declare `viewport-fit=cover` and
respect the safe area, so the site draws to the edges of the screen without
putting text under the camera cutout or the home indicator.

**Mobile browser bars broke full-height layouts.** `100vh` on iOS includes the
address bar, which means a screenful is taller than the screen. Now `100dvh`,
which measures what is actually visible.

---

## Sizes the layout is built for

| Device | Width | What changes |
|---|---|---|
| Small phone | 320–380px | Tighter gutters, smaller headlines, menus scroll sideways |
| Phone | 381–720px | Single column, ad slots full width, 44px tap targets |
| Tablet portrait | 721–959px | Two-column card grids, full-width article |
| Tablet landscape / laptop | 960–1499px | Article gains its contents sidebar |
| Desktop | 1500–1799px | Content ceiling rises to 1360px |
| Large display | 1800px+ | Ceiling rises to 1560px |

Advertising rails appear at 1200px and widen at 1600px, and only when there is
something in them. Below 1200px they do not exist at all.

Phone in landscape and an installed app on the home screen each get their own
adjustments — a shorter masthead in the first case, safe-area padding in the
second.

---

## The hour that still needs a person

Open `https://sustech360.com` on each of these and look. You are checking for
three things every time: **nothing scrolls sideways**, **nothing is cut off**,
and **the menu does not get in the way**.

- [ ] **An iPhone, in Safari.** Portrait and landscape. Tap the search box — the
      page must not zoom. Scroll an article to the bottom.
- [ ] **An Android phone, in Chrome.** The same. Then add the site to your home
      screen and open it from there.
- [ ] **A tablet.** Portrait and landscape. The article's contents sidebar
      should appear in landscape and not in portrait.
- [ ] **A laptop.** Then drag the window narrow and back — nothing should jump
      or overlap at any width in between. Watch the side rails appear at about
      1200px and disappear below it; the text column should stay centred either
      way.
- [ ] **The control centre on your phone.** Sign in, open the queue, scroll a
      table sideways, approve something. This is the screen you will use in a
      hurry, away from your desk.
- [ ] **The author portal on your phone.** Write two sentences in the editor and
      save. This is what your authors will do.
- [ ] **A slow connection.** In Chrome: DevTools → Network → Slow 4G. The page
      should show its structure quickly and fill in, rather than staying blank.

If something looks wrong, note the device, the width and what you saw. That is
enough for anyone to fix it — far more useful than "it looks odd on mobile".

---

## When you change the design

Run `node tools/responsive.js`. Twelve checks, under a second. It will not catch
everything, but it catches the things that are easy to break and hard to notice:
a table without a scroll box, a field that zooms an iPhone, a width that a small
phone cannot show.
