# Development Guidelines & Rules

## Language & Communication
- **Thinking & Workflow**: Always use English for internal reasoning, planning, and code comments.
- **User Communication**: Respond in Vietnamese only when explaining to the user. Keep explanations concise, clear, and direct without unnecessary verbosity.

## Code Integrity & Scope
- **Do Not Touch Unrelated Code**: Never modify or alter completed or unrelated parts of the codebase. Strictly scope changes to the requested task.
- **Verification**: Always inspect and verify code correctness (syntax, logic, dependencies) before marking any task as complete.

## Impeccable Design Standards (Enforced)
- **Product Truth**: Always align with [PRODUCT.md](file:///d:/KhoDoModel64/PRODUCT.md) (target audience, problems solved, core constraints).
- **Design System**: Strictly adhere to [DESIGN.md](file:///d:/KhoDoModel64/DESIGN.md) (dark cockpit aesthetic, Outfit typography, semantic colors, token scale).
- **Anti-AI Slop Rules**:
  - No low-contrast muddy text on dark backgrounds.
  - No redundant nested cards or generic pill buttons.
  - Financial figures must ALWAYS be formatted via `formatCurrency()` and right-aligned.
  - Mobile touch targets must be >= 44px with zero horizontal layout breakage.
