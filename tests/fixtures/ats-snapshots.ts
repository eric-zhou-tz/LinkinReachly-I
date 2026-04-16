/**
 * Realistic accessibility tree snapshots from major ATS vendors.
 * These mirror the actual form structures seen during E2E certification.
 * Used by snapshot-field-matcher tests to validate matching against real forms.
 */

export const ATS_SNAPSHOTS = {
  greenhouse: {
    vendor: 'greenhouse',
    formType: 'multi-step',
    snapshot: `- heading "Apply for Senior Software Engineer" [ref=h1]:
- textbox "First Name*" [ref=e1]:
- textbox "Last Name*" [ref=e2]:
- textbox "Email*" [ref=e3]:
- textbox "Phone" [ref=e4]:
- textbox "Resume/CV*" [ref=e5]:
- button "Attach" [ref=b1]:
- textbox "Cover Letter" [ref=e6]:
- button "Attach" [ref=b2]:
- textbox "LinkedIn Profile" [ref=e7]:
- textbox "Website" [ref=e8]:
- generic "How did you hear about this job?*" [ref=g1]:
- combobox "" [ref=c1]:
- button "Submit Application" [ref=s1]:`,
    expectedMatches: ['e1', 'e2', 'e3', 'e4', 'e7', 'e8'],
    expectedUnmatched: ['Resume/CV*', 'Cover Letter']
  },

  lever: {
    vendor: 'lever',
    formType: 'multi-step',
    snapshot: `- heading "Apply for Product Manager" [ref=h1]:
- textbox "Full name*" [ref=e1]:
- textbox "Email*" [ref=e2]:
- textbox "Phone" [ref=e3]:
- textbox "Current company" [ref=e4]:
- textbox "LinkedIn URL" [ref=e5]:
- textbox "Twitter URL" [ref=e6]:
- textbox "GitHub URL" [ref=e7]:
- textbox "Portfolio URL" [ref=e8]:
- generic "Resume/CV" [ref=g1]:
- button "Upload File" [ref=uf1]:
- textbox "Additional information" [ref=e9]:
- button "Submit application" [ref=s1]:`,
    expectedMatches: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'],
    expectedUnmatched: ['Additional information']
  },

  ashby: {
    vendor: 'ashby',
    formType: 'single-page',
    snapshot: `- heading "Backend Engineer" [ref=h1]:
- textbox "Name*" [ref=e1]:
- textbox "Email*" [ref=e2]:
- textbox "Phone number" [ref=e3]:
- textbox "LinkedIn" [ref=e4]:
- textbox "Current company" [ref=e5]:
- generic "Resume" [ref=g1]:
- button "Upload File" [ref=uf1]:
- generic "Are you legally authorized to work in the United States?*" [ref=q1]:
- button "Yes" [ref=y1]:
- button "No" [ref=n1]:
- generic "Will you now or in the future require sponsorship for employment visa status?*" [ref=q2]:
- button "Yes" [ref=y2]:
- button "No" [ref=n2]:
- button "Submit Application" [ref=s1]:`,
    expectedMatches: ['e1', 'e2', 'e3', 'e4', 'e5'],
    expectedClickMatches: ['y1', 'n2'],
    expectedUnmatched: [] as string[]
  },

  workday: {
    vendor: 'workday',
    formType: 'multi-step',
    snapshot: `- heading "Create Account or Sign In" [ref=h1]:
- textbox "Email address*" [ref=e1]:
- textbox "Password*" [ref=e2]:
- button "Sign In" [ref=b1]:
- heading "My Information" [ref=h2]:
- textbox "Legal Name - First Name*" [ref=e3]:
- textbox "Legal Name - Last Name*" [ref=e4]:
- combobox "Country / Region*" [ref=c1]:
- textbox "Address Line 1" [ref=e5]:
- textbox "City*" [ref=e6]:
- combobox "State*" [ref=c2]:
- textbox "Postal Code" [ref=e7]:
- textbox "Phone Number*" [ref=e8]:
- textbox "Phone Extension" [ref=e9]:
- button "Next" [ref=n1]:`,
    expectedMatches: ['e1', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'c1', 'c2'],
    expectedUnmatched: ['Password*']
  },

  bamboohr: {
    vendor: 'bamboohr',
    formType: 'single-page',
    snapshot: `- heading "Apply for Data Analyst" [ref=h1]:
- textbox "First Name*" [ref=e1]:
- textbox "Last Name*" [ref=e2]:
- textbox "Email*" [ref=e3]:
- textbox "Phone*" [ref=e4]:
- textbox "Street" [ref=e5]:
- textbox "City*" [ref=e6]:
- combobox "State*" [ref=c1]:
- textbox "Zip" [ref=e7]:
- generic "Desired Salary" [ref=g1]:
- textbox "" [ref=e8]:
- generic "Date Available" [ref=g2]:
- textbox "" [ref=e9]:
- generic "Resume" [ref=g3]:
- button "Upload File" [ref=uf1]:
- textbox "Website URL" [ref=e10]:
- textbox "LinkedIn URL" [ref=e11]:
- button "Submit Application" [ref=s1]:`,
    expectedMatches: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e10', 'e11', 'c1'],
    expectedUnmatched: [] as string[]
  },

  smartrecruiters: {
    vendor: 'smartrecruiters',
    formType: 'multi-step',
    snapshot: `- heading "Software Engineer — Apply" [ref=h1]:
- textbox "First name*" [ref=e1]:
- textbox "Last name*" [ref=e2]:
- textbox "Email address*" [ref=e3]:
- textbox "Phone number" [ref=e4]:
- textbox "Location*" [ref=e5]:
- generic "Resume" [ref=g1]:
- button "Upload" [ref=uf1]:
- textbox "LinkedIn profile URL" [ref=e6]:
- textbox "Cover letter" [ref=e7]:
- generic "Are you authorized to work in the US?" [ref=q1]:
- button "Yes" [ref=y1]:
- button "No" [ref=n1]:
- generic "Do you require visa sponsorship?" [ref=q2]:
- button "Yes" [ref=y2]:
- button "No" [ref=n2]:
- button "Apply" [ref=s1]:`,
    expectedMatches: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'],
    expectedClickMatches: ['y1', 'n2'],
    expectedUnmatched: ['Cover letter']
  }
}
