# Beam repository guidance

- Describe what the code does or changes in commit messages and code comments.
- Keep field rationale, operational cases and their supporting observations in internal dispatch reports. Use synthetic examples and fixtures when documenting or testing observable behavior in this repository.
- Use the [UX register](docs/ux-register.md) when changing behavior and verify the affected workflow in the built app.
- Keep each commit focused on one independently verifiable change with its checks passing. Carry preview changes forward in functional slices rather than copying the entire preview in one commit.
