# Security and safe operation

Beam’s public site is static. Default runtime policy denies connections and form submissions. Workbooks and scans stay in the browser unless the operator explicitly saves or shares a file. Do not load real warehouse data into public demos or run browser extensions you do not trust on the same workstation.

## November 2026 review

- **Chrome and Microsoft Edge:** [Google’s November 9 desktop update](https://chromereleases.googleblog.com/2026/11/stable-channel-update-for-desktop_018223192.html) reports in-the-wild exploitation of CVE-2026-125350. See the [Microsoft Edge security release notes](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnotes-security) for Edge. Keep the approved browser channel current, including on shared workstations. A Beam deployment or its content security policy does not apply browser engine security patches.
- **Node.js:** the [November 2026 security releases](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases/) include Node.js 24.22.3. Use the current patched 24 LTS version for CI, development, and any separately operated Beam service. The public Pages site does not run Node.js when an operator uses it.
- **Git:** the [November 2026 Git advisory](https://github.blog/open-source/git/git-security-vulnerabilities-announced-7/) covers build and source-control tools; keep self-managed Git clients and runners patched. The public browser app does not execute Git.

Continue applying browser, operating-system and build-tool updates. This review did not assess corporate workstations or optional integrations in a live tenant.
