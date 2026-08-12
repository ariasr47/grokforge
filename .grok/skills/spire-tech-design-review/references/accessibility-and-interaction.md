# Accessibility and interaction review

## Keyboard and focus

Every interactive element is reachable in a logical order and has a visible focus state. Opening a dialog or error summary moves focus deliberately; closing returns it to a sensible trigger. While a modal dialog is open, Tab and Shift+Tab keep focus inside it. Provide a skip path around repeated navigation where the surface needs one.

## Semantics and announcements

Use native controls for their intended behavior: buttons for actions, links for navigation, labels associated with controls and hierarchical headings. Images have meaningful alternative text or empty text when decorative. Dynamic status and error changes are announced without stealing focus unnecessarily.

## Forms

Inputs have visible labels, useful autocomplete and input modes where applicable. Errors appear beside the field and in a discoverable summary when needed. Preserve entered data, never block paste, describe requirements before submission and disable submission only while the request is actually pending.

## Interaction and motion

Touch targets meet the platform floor. Hover never carries essential information alone. Destructive actions confirm or provide undo. Motion communicates state without blocking input and respects reduced-motion preferences.

## Content and layout resilience

Test zoom, narrow and wide viewports, short and long content, localization expansion, safe areas and text wrapping. Images reserve dimensions to avoid layout movement. Truncation is deliberate and preserves access to the full value when needed.

## Contrast and non-color cues

Text, controls, focus and state indicators meet the project's accessibility target. Color is not the only carrier of status or error. Review disabled and placeholder content without making essential information unreadable.
