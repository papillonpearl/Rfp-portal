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
    const fd = new FormData(e.currentTarget)
    startTransition(() => action(fd))
  }
}
