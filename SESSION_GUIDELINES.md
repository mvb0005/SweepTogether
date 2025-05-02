# Development Session Guidelines

This document provides guidance on how to structure, execute, and document development sessions for this project.

## Session Structure

Each development session follows a consistent structure:

1. **Planning**: Define clear goals and deliverables for the session
2. **Implementation**: Write code to fulfill the session objectives
3. **Testing**: Verify implementation works as expected
4. **Documentation**: Record what was accomplished

## Session Ending Procedure

At the end of each development session, follow these steps to ensure proper documentation and state preservation:

### 1. Code Implementation
- Ensure all implementation tasks are completed
- Run relevant tests to verify functionality
- Fix any identified bugs or issues

### 2. Test Coverage
- Run tests with coverage reporting to verify implementation quality
- Address any significant gaps in test coverage
- Use the following command to check coverage for specific components:
  ```bash
  cd /backend && npx jest [path/to/tests] --coverage
  ```

### 3. Documentation Update
- Add a summary entry to SESSIONS.md following the established format:
  ```markdown
  ## Session XX: [Title](./prompts/SESSION_XX_Title.md) (YYYY-MM-DD)
  Brief description of accomplishments and key design decisions.
  ```
- The description should highlight key accomplishments, design decisions, and learnings
- Ensure the session title matches the prompt file name for consistency

### 4. Session File
- If not already created, add a session file in the `prompts/` directory using the standard format:
  ```markdown
  # Session XX: Title
  
  ## Original Prompt
  [Include the original prompt that initiated the session]
  
  ## Session Notes
  [Document what was accomplished, key decisions, challenges, etc.]
  ```

### 5. Commit Guidelines (if committing code)
- Use format: `Session XX: Brief description of changes`
- Include relevant details about implementation approach
- Reference any issues or tickets being addressed

By following this procedure consistently, we maintain clear documentation of project progress and ensure knowledge transfer between sessions.