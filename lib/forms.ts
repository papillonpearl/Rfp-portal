'use client'

import { startTransition, type FormEvent } from 'react'

/**
 * Submit a form to an action WITHOUT React's automatic reset.
 *
 * With <form action={fn}>, React 19 clears every uncontrolled field once the
 * action finishes — including when it returned a validation error. The
 * person then fixes the one bad field, resubmits, and is told every other
 * field is empty. Use this for any form whose action can refuse its input.
 */
export function submitKeepingInput(action: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Pass the submitter, or the pressed button's name=value is lost and
    // "Save draft" and "Submit" become the same request.
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null
    const fd = new FormData(e.currentTarget, submitter)
    startTransition(() => action(fd))
  }
}
