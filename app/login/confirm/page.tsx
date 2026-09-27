import { ConfirmForm } from './confirm-form'

// The emailed link lands here, not on the token-spending callback. Mail
// scanners fetch this page harmlessly; only a person pressing the button
// submits the token. See confirmationUrl() in auth.ts for why the token is in
// the fragment, and so can only be read in the browser.
export default function ConfirmPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <ConfirmForm />
    </main>
  )
}
