# Design System

## Philosophy

Build an interface that feels like a **quiet workspace for thinking**, not a conventional AI dashboard.

The design should feel:

* Calm
* Editorial
* Warm
* Intelligent
* Tactile
* Spacious
* Understated
* Premium without feeling luxurious
* Human rather than technological

Avoid the visual language commonly associated with AI products:

* Purple/blue gradients
* Excessive glassmorphism
* Excessive rounded cards
* Heavy shadows
* Neon accents
* Dense dashboards
* Generic SaaS layouts
* Overuse of borders
* Inter/Roboto-style generic typography
* Decorative UI that doesn't improve comprehension

The interface should almost disappear while the user is thinking.

---

# 1. Visual Direction

The primary reference is a **well-designed notebook or editorial workspace** translated into a modern digital product.

Think:

> paper + modern typography + subtle software controls

rather than:

> futuristic AI + dashboard + cards

The interface should have very little visual noise.

Large areas of empty space are intentional.

Content should feel like it has room to breathe.

---

# 2. Color System

Use a warm neutral foundation rather than pure white.

### Light theme

```css
:root {
  --background: #F7F6F2;
  --surface: #FFFFFF;
  --surface-subtle: #F2F1ED;

  --text-primary: #1F1F1D;
  --text-secondary: #6F6D67;
  --text-tertiary: #99968F;

  --border: #E5E3DD;
  --border-subtle: #ECEAE5;

  --accent: #C96B45;
  --accent-hover: #B95E3B;

  --danger: #B94A48;
  --success: #5D8068;
}
```

Do not make every surface white.

Use slight tonal differences between:

* application background
* sidebar
* composer
* popovers
* modal surfaces
* content surfaces

The differences should be subtle enough that the user feels them before consciously noticing them.

### Dark theme

Dark mode should remain warm.

Avoid pure black.

```css
:root[data-theme="dark"] {
  --background: #1A1917;
  --surface: #22211F;
  --surface-subtle: #292824;

  --text-primary: #F1EFE9;
  --text-secondary: #AAA79F;
  --text-tertiary: #77746D;

  --border: #383631;
  --border-subtle: #302F2B;

  --accent: #D47A52;
}
```

---

# 3. Typography

Typography is one of the most important parts of the interface.

Do not treat typography as decoration.

It establishes the personality of the product.

Anthropic's current design direction favors distinctive typography over generic UI fonts. Anthropic's own frontend guidance explicitly recommends avoiding generic choices such as Arial and Inter in favor of more distinctive typefaces.

## Primary UI font

Use the closest available Anthropic Sans-like typeface.

```css
font-family:
  "Anthropic Sans",
  "Inter",
  system-ui,
  sans-serif;
```

If Anthropic's proprietary font is unavailable, use a high-quality humanist/geometric sans rather than trying to fake the exact typeface.

## Reading / response font

Long-form assistant responses should have a slightly editorial character.

Prefer:

```css
font-family:
  "Anthropic Serif",
  "Source Serif 4",
  Georgia,
  serif;
```

The serif should not be used everywhere.

Use it primarily where extended reading benefits from it.

## Monospace

```css
font-family:
  "SFMono-Regular",
  "Cascadia Mono",
  "Roboto Mono",
  monospace;
```

Use monospace for:

* code
* technical identifiers
* keyboard shortcuts
* file paths
* command output

---

# 4. Type Scale

Use a restrained scale.

```css
--text-xs: 0.75rem;
--text-sm: 0.8125rem;
--text-md: 0.9375rem;
--text-lg: 1.0625rem;
--text-xl: 1.25rem;
--text-2xl: 1.5rem;
--text-3xl: 2rem;
```

Recommended usage:

| Element             |    Size |
| ------------------- | ------: |
| Tiny metadata       |    12px |
| Sidebar labels      |    13px |
| Secondary UI        | 13–14px |
| Body UI             |    15px |
| Chat text           |    16px |
| Large response text | 16–18px |
| Section heading     | 20–24px |
| Page heading        | 28–32px |

Avoid huge hero typography inside the application.

The content is the hero.

---

# 5. Typography Rules

### Weight

Use weight sparingly.

Preferred:

```text
400 — body
450 — emphasized body
500 — controls
600 — headings
```

Avoid excessive 700/800 weights.

### Line height

Reading content should be generous.

```css
--leading-body: 1.65;
--leading-heading: 1.2;
--leading-ui: 1.4;
```

### Paragraph width

Do not allow responses to span the entire screen.

Ideal reading width:

```css
max-width: 720px;
```

For particularly comfortable reading:

```css
max-width: 680px;
```

---

# 6. Layout

The application should use a two-part workspace:

```text
┌──────────────────────────────────────────────────────────────┐
│ Sidebar │                     Main workspace                 │
│         │                                                     │
│         │                                                     │
│         │                Conversation                        │
│         │                                                     │
│         │                                                     │
│         │                                                     │
│         │              ┌──────────────────────┐              │
│         │              │      Composer        │              │
│         │              └──────────────────────┘              │
└──────────────────────────────────────────────────────────────┘
```

The main workspace should dominate the screen.

The sidebar should feel like a navigation rail, not a separate application.

---

# 7. Sidebar

### Desktop width

```css
width: 260px;
```

Allow a slightly wider implementation when project names or navigation require it:

```css
width: 250px–280px;
```

The sidebar should feel compact.

It should not contain large decorative elements.

### Structure

```text
Workspace / account

New chat

Search

Chats
  Recent conversation
  Recent conversation
  Recent conversation

Projects
  Project
  Project

Artifacts

Settings
```

Keep navigation visually quiet.

---

# 8. Sidebar Interaction

Inactive items:

```css
color: var(--text-secondary);
```

Active items:

```css
background: var(--surface-subtle);
color: var(--text-primary);
```

Use a small radius:

```css
border-radius: 8px;
```

Avoid enormous pill-shaped navigation elements.

### Hover

Hover should be subtle.

```css
background: rgba(0, 0, 0, 0.04);
```

Never use a dramatic hover animation.

---

# 9. Main Conversation

The conversation is the primary interface.

Do not put every message inside a card.

Avoid:

```text
┌─────────────────────┐
│ User message        │
└─────────────────────┘

┌─────────────────────┐
│ AI message          │
└─────────────────────┘
```

Instead, allow content to exist naturally on the page.

The interface should resemble a conversation/document rather than a collection of cards.

---

# 10. Message Width

User and assistant messages should not span the full viewport.

```css
.message-container {
  width: min(100%, 760px);
  margin-inline: auto;
}
```

For large displays:

```css
max-width: 760px;
```

For extremely wide displays, maintain generous margins.

---

# 11. User Messages

User messages should be visually lighter than conventional chat applications.

Avoid huge colored bubbles.

Use:

* dark text
* minimal background
* modest radius
* restrained spacing

Example:

```css
.user-message {
  background: var(--surface-subtle);
  border-radius: 14px;
  padding: 10px 14px;
}
```

The bubble should not dominate the conversation.

---

# 12. Assistant Messages

Assistant responses should feel like document content.

Do not put the assistant's entire response into a card.

Use:

```css
.assistant-message {
  color: var(--text-primary);
  line-height: 1.65;
}
```

Markdown should feel editorial.

---

# 13. Markdown

### Headings

Keep headings compact.

```text
## Heading
```

should feel like a section inside an article, not a dashboard title.

### Lists

Use generous vertical spacing.

```css
li + li {
  margin-top: 0.35rem;
}
```

### Paragraphs

```css
p + p {
  margin-top: 1rem;
}
```

### Strong text

Use bold for genuine emphasis.

Do not bold every important phrase.

---

# 14. Code Blocks

Code should visually separate from prose without becoming a giant dark rectangle.

```css
.code-block {
  background: #242321;
  border-radius: 10px;
  padding: 16px;
  overflow-x: auto;
}
```

Code typography should be:

```css
font-size: 13px;
line-height: 1.6;
```

Include a small language label or copy action when appropriate.

---

# 15. Composer

The composer is one of the most important components.

It should feel like a physical writing surface.

### Shape

Use a moderately rounded container:

```css
border-radius: 18px;
```

Not:

```css
border-radius: 9999px;
```

### Structure

```text
┌──────────────────────────────────────────────────────┐
│                                                      │
│  Ask anything...                                     │
│                                                      │
│  +  Attachments                 Tools       ↑        │
└──────────────────────────────────────────────────────┘
```

The composer should be visually heavier than surrounding UI, but only slightly.

### Shadow

Use extremely subtle elevation.

```css
box-shadow:
  0 2px 12px rgba(0,0,0,.04);
```

Avoid dramatic floating-card shadows.

---

# 16. Composer States

### Default

Quiet border.

### Focus

Do not use a bright blue browser-style outline.

Instead:

```css
border-color: var(--text-tertiary);
```

or a subtle accent ring.

### Sending

The send button becomes active.

### Empty

Controls remain available but visually quiet.

### Disabled

Reduce opacity without changing layout.

---

# 17. Buttons

Buttons should look like controls rather than marketing components.

Primary:

```css
height: 36px;
padding-inline: 14px;
border-radius: 8px;
font-size: 14px;
font-weight: 500;
```

Secondary:

```css
background: transparent;
border: 1px solid var(--border);
```

Icon buttons:

```css
width: 36px;
height: 36px;
border-radius: 8px;
```

Avoid excessive pill buttons.

---

# 18. Icons

Icons should be:

* simple
* geometric
* 16–20px
* visually light
* consistent in stroke width

Prefer Lucide-style icons.

Never use emoji as UI icons.

Icons should support text rather than compete with it.

---

# 19. Border Radius

Use a small set of radii.

```css
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-xl: 18px;
```

Rules:

* buttons: 8px
* navigation: 8px
* popovers: 10–12px
* cards: 12px
* composer: 18px
* dialogs: 14–16px

Avoid mixing many unrelated radii.

---

# 20. Borders

Borders should be barely visible.

Use:

```css
1px solid var(--border);
```

Avoid heavy outlines.

A good rule:

> If you notice the border before you notice the content, it is too strong.

---

# 21. Shadows

Use elevation sparingly.

### Level 1

```css
box-shadow: 0 1px 3px rgba(0,0,0,.04);
```

### Level 2

```css
box-shadow:
  0 4px 12px rgba(0,0,0,.06);
```

### Level 3

```css
box-shadow:
  0 10px 30px rgba(0,0,0,.10);
```

Most application elements should use no shadow.

---

# 22. Motion

Motion should communicate state, not entertain.

Use:

```css
transition:
  background-color 120ms ease,
  border-color 120ms ease,
  opacity 120ms ease,
  transform 120ms ease;
```

Avoid:

* bouncing UI
* excessive spring animations
* large page transitions
* constant floating animations
* decorative particles

Good animation examples:

* sidebar appearing
* composer focus
* message streaming
* menu opening
* artifact panel sliding into view

---

# 23. Streaming Responses

Streaming should feel natural.

Do not make the entire interface jump as content arrives.

Reserve enough layout space where possible.

The cursor/caret should be subtle.

Do not animate every word individually.

---

# 24. Loading State

Prefer understated loading indicators.

Avoid:

```text
● ● ●
```

large animated dots as the primary visual language.

Use a subtle shimmer or small animated indicator.

Loading should communicate:

> Claude is working.

not:

> Look at this animation.

---

# 25. Popovers

Popovers should feel like physical pieces of the interface.

```css
background: var(--surface);
border: 1px solid var(--border);
border-radius: 12px;
box-shadow: 0 8px 24px rgba(0,0,0,.08);
```

Padding:

```css
6px;
```

Menu item height:

```css
36px;
```

---

# 26. Dialogs

Dialogs should be compact.

Avoid full-screen modal experiences unless the task genuinely requires them.

Use:

```css
max-width: 520px;
border-radius: 16px;
```

Background should remain visually connected to the application.

---

# 27. Artifacts / Side Panels

Artifacts should feel like a second workspace rather than a modal.

Conceptually:

```text
┌───────────────┬──────────────────────────────┐
│               │                              │
│ Conversation  │          Artifact            │
│               │                              │
│               │                              │
│               │                              │
│               │                              │
└───────────────┴──────────────────────────────┘
```

The artifact area should have its own visual hierarchy.

Anthropic's artifact model explicitly uses a dedicated window alongside the conversation, reinforcing this split-workspace pattern.

---

# 28. Responsive Design

### Desktop

Sidebar visible.

Conversation centered.

Artifact panel can occupy approximately 40–50% of the viewport when active.

### Tablet

Sidebar becomes collapsible.

Conversation width remains constrained.

### Mobile

Remove persistent sidebar.

Use a compact top navigation.

Composer should remain fixed near the bottom while respecting the mobile keyboard and safe areas.

Do not simply shrink the desktop interface.

Recompose it.

---

# 29. Spacing System

Use a 4px base unit.

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
```

Use whitespace aggressively.

The interface should never feel cramped.

---

# 30. Content Density

Default density should be low.

Prefer:

```text
more whitespace
less chrome
fewer borders
fewer controls
```

The user should be able to read several paragraphs without feeling that they're inside a dashboard.

---

# 31. Accessibility

Maintain WCAG-compliant contrast.

Never use color alone to communicate state.

Every icon-only button requires an accessible label.

Keyboard navigation must be first-class.

Focus states should be visible but visually restrained.

Respect:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

# 32. Design Tokens

Centralize everything.

```css
:root {
  /* Colors */
  --background: #F7F6F2;
  --surface: #FFFFFF;
  --surface-subtle: #F2F1ED;

  --text-primary: #1F1F1D;
  --text-secondary: #6F6D67;
  --text-tertiary: #99968F;

  --border: #E5E3DD;

  --accent: #C96B45;

  /* Typography */
  --font-ui: "Anthropic Sans", system-ui, sans-serif;
  --font-reading: "Anthropic Serif", Georgia, serif;
  --font-mono: "SFMono-Regular", monospace;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 18px;

  /* Motion */
  --duration-fast: 120ms;
  --duration-normal: 180ms;
  --ease-standard: cubic-bezier(.2,.8,.2,1);
}
```

---

# 33. Component Principles

Every component should satisfy at least one of these:

1. Help the user understand something.
2. Help the user navigate.
3. Help the user create something.
4. Help the user control the conversation.

If a component does none of these, remove it.

---

# 34. What NOT to Build

Do not introduce these patterns unless there is a strong product reason:

* Gradient hero sections
* Purple AI gradients
* Glassmorphism
* Giant rounded cards
* Excessive pills
* Excessive drop shadows
* Neon colors
* Floating blobs
* Decorative 3D objects
* Excessive icons
* Dashboard-style statistics
* "AI magic" sparkles everywhere
* Generic Inter-based SaaS styling
* Chat bubbles around every message

The product should feel **confident enough not to decorate itself**.

---

# 35. Brand Personality

The visual system should communicate:

> "You have room to think here."

Not:

> "Look how advanced our AI is."

The interface should feel like a **tool made by people who care about writing, reading, and thinking**.

It should be quiet enough to disappear.

---

# 36. Implementation Rule

When making a design decision, prioritize in this order:

1. Content clarity
2. Reading comfort
3. Interaction simplicity
4. Visual hierarchy
5. Consistency
6. Brand personality
7. Decoration

Never sacrifice the first five for the last two.

---

# 37. Final Design Test

Before shipping a page, ask:

### Does it feel calm?

If not, remove something.

### Does the content have enough space?

If not, increase whitespace.

### Are there unnecessary borders?

Remove them.

### Are there too many rounded containers?

Flatten some.

### Is the typography doing enough work?

Improve hierarchy rather than adding UI.

### Does the page look like a generic AI product?

If yes, redesign it.

### Could the user focus for 30 minutes without feeling visually exhausted?

If no, simplify.

---

# Core Principle

**The interface should feel less like software and more like a well-made place to think.**
