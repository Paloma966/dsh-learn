# Using AI Learning Skill with Cursor

## Setup

1. Copy `.cursor/rules/ai-learning.mdc` into your project's `.cursor/rules/` directory
2. The rule is set to `alwaysApply: false` — activate it manually when you want to create a learning skeleton
3. Or, set `alwaysApply: true` in the rule metadata if you want it active for all coding sessions

## Usage

1. Open the project you want to learn in Cursor
2. In Composer or Chat, say: "I want to learn this project, create a learning skeleton"
3. Cursor will apply the AI Learning guidelines and follow the 4-phase process

## Maintenance

- Keep `.cursor/rules/ai-learning.mdc` in sync with `skills/ai-learning/SKILL.md`
- The `.mdc` file is a condensed version optimized for Cursor's context window
- When updating the skill, update both files
