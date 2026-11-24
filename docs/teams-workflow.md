# Beam with Microsoft Teams

Beam's offline inspection and browser recovery are independent of a Teams tab.
A Teams channel can link to Beam without granting Beam any Microsoft account,
channel, message, or storage access.

For authorized file integration, the recommended topology is:

- An administrator identifies the channel's SharePoint site and the exact
  document library and folders. A standard channel uses its team's site;
  private/shared channels can have a separate site. Chat attachments are a
  different case and can live in the sender's OneDrive.
- Keep the workbook and data-connection profile versioned in the company's
  SharePoint. If a future reader is enabled, give it read access to the exact
  workbook or input folder, not tenant-wide enumeration. Do not sync the
  entire library to the Windows workstation.
- Workers authenticate with their own company accounts. An opt-in Microsoft
  export build can write new records only to the pre-approved results folder,
  provided both the app and the individual worker can add files there.
- Work-only records exclude workbook contents, customer lookup lists and
  source paths, but may still contain operational identifiers. Restore
  against the identical reference data; keep that revision in SharePoint.
- Posting to Teams or embedding Beam inside Teams is not required. An
  embedded app, if adopted, is a separate administrative deployment and must
  support the Microsoft Teams frame and authentication requirements.

The default public site has no Microsoft login, live SharePoint reader, file
sync or Teams bot. Optional OneDrive export must be staged with synthetic
records before any company destination is configured.

Official documentation:
[Teams and SharePoint integration](https://learn.microsoft.com/en-us/microsoftteams/sharepoint-onedrive-interact),
[scoped permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview),
[Teams tab requirements](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/tab-requirements).
