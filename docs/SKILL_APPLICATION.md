# Requested skill: installation and application

Executed successfully in the project directory:

```sh
npx --yes skills@1.7.2 add https://github.com/github/awesome-copilot --skill premium-frontend-ui --yes
```

Requested source: https://github.com/github/awesome-copilot/tree/main/skills/premium-frontend-ui
Installed original: `.agents/skills/premium-frontend-ui/SKILL.md`; installer provenance: `skills-lock.json`.
Installed SKILL.md SHA-256: `b7edf35b33931d15ea0c1d271f3c05d469e2b6923ed4df1c955d4da86287d9fb`.
Repository HEAD observed before installation: `156736fb63e965b2f547a1460f3b5972c46e6b24` (the install command targeted the repository default branch, not a pinned commit).

## Applied
- Intentional editorial campus / technical workspace identity rather than generic card-only styling.
- Locally hosted Inter variable type and prominent headline hierarchy.
- New sidebar workspace, immersive two-panel dashboard hero and split-screen login.
- GSAP 3.15.0 vanilla entrance choreography, ScrollTrigger depth, small hero-button interaction and scroll-aware desktop breadcrumb bar.
- Cohesive dark mode, mobile navigation, meaningful states, readable data and forms.
- Composite-only transform/opacity animation and reduced-motion / touch degradation.

## Deliberately adapted
The skill contains aspirational marketing-site techniques. Blocking preloaders, full-screen dashboard sections, scroll hijacking, custom cursors, mega-menus and decorative 3D were not imposed on this CRUD learning application. Users must be able to read results, enter forms and navigate immediately. Grid texture and SVG icons are code-native visual assets; no stock photo is needed for the chosen technical direction.

Original skill content is retained for provenance, not automatically executed at runtime. Third-party frontend assets retain their own license files. GSAP uses its Standard License; review it before reuse, especially in animation-building products.

## Additional repository requested during final review

Reviewed https://github.com/jakubkrehel/skills and found relevant, usable guidance. Selected `better-accessibility` and `better-typography`; did not claim to run its all-domain `better-interface` review or its user-invoked review skills. No subagents were used.

Installed successfully:

```sh
npx --yes skills@1.7.2 add https://github.com/jakubkrehel/skills --skill better-accessibility better-typography --yes
```

Repository revision reviewed: `4c66b1fa86e9ab70187b43d7da9b6fdb29f2ef63`. Original skills and their references are retained in `.agents/skills`; `skills-lock.json` records installer provenance.

Applied recommendations: rem-based text sizes, mobile CSV input at 16px default-root size, focus scroll clearance, robust skip-link hiding/focus, keyboard-focusable main target, sufficient select-arrow clearance, polite success status semantics, username spellcheck disabled, tabular changing numbers, pretty paragraph wrapping and forced-colors focus fallback. Retained the existing Inter identity, native controls, labels and reduced-motion behavior. See ADDITIONAL_SKILL_REVIEW.md for the exact verification boundary.

Installed source file SHA-256 values:
- better-accessibility: `df0cafe0e75a08548cf46a2a430f46c198e7e0ee9d46bdf7884c2afefb44b70e`
- better-typography: `e60ca6467ba60e68f95ed2d2cfa35f2a850d96ef2a0c0d3fcfcfd9510e51f184`

## Emil Kowalski repository requested during final refinement

Reviewed https://github.com/emilkowalski/skills at observed revision `2d228630ba1446365f614a108cb8252f1feda202`. `apple-design` and `animation-performance` were relevant to this web interface and installed successfully:

```sh
npx --yes skills@1.7.2 add https://github.com/emilkowalski/skills --skill apple-design animation-performance --yes
```

Applied: immediate press feedback, touch-action manipulation, shortened 350ms entrance motion, reduced-transparency and increased-contrast solid material fallbacks, an explicit reduced-motion guard on hero-button pointer exit, and breadcrumb focus recovery. Existing GSAP/ScrollTrigger animations still use transform/opacity and do not block forms. Removed the unused button shadow transition rather than adding another animation library.

Not imposed: gesture physics, momentum, rubber-banding, 3D, haptics, sound or a new spring library. This application has no drag/swipe task that would justify them. Inter remains intentionally chosen for the campus editorial identity; platform fallbacks remain available. Apple's branding is not copied.

Verification: local Chromium press feedback computed scale 0.98 with 0s transition; emulated reduced-transparency/increased-contrast preferences yield a solid header and no backdrop blur. Machine evidence: apple-motion-checks.json. Source inspection confirms bounded transform/opacity GSAP motion and no custom transition:all. GSAP still runs on the main thread; no claim of compositor-driven GSAP, guaranteed FPS, physical-device profiling, Safari verification or native spring velocity handoff is made.

apple-design SKILL.md SHA-256: `77bb63b7043bb93aca2ff4ab040c249484eef35682bb6ff7163433c31d30adc7`

animation-performance SKILL.md SHA-256: `ceb9dd3fe912615830f725a0120ccf8d012d15a6218001a5cd6c15d38e39a957`
