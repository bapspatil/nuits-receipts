// What a page needs to know about the request it is answering, without every
// page function taking it as an argument: the query (for the feedback banner)
// and, after a refused form, what was typed and what was wrong. It lives in
// AsyncLocalStorage (nodejs_compat is on), so concurrent requests in one
// isolate never see each other's values; nothing here is module-level state.
import { AsyncLocalStorage } from 'node:async_hooks';

// A refused form, for the page that holds the form to show in place.
export type FormFailure = {
  message: string;
  // The form control at fault, by its name, when one is.
  field?: string;
  // Which form on the page was submitted ("receipt", "match:<payment id>", "import", "setup:<group>").
  scope: string;
  // What was typed, by control name.
  values: Record<string, string>;
};
export type RequestState = {
  params: URLSearchParams;
  // The form a POST handler read, kept so a refusal can show it again.
  form?: FormData;
  failure?: FormFailure;
};

export const requestState = new AsyncLocalStorage<RequestState>();

// The submitted value of a control in the form that was refused, else the saved one.
export function kept(scope: string, name: string, fallback: unknown): unknown {
  const failure = requestState.getStore()?.failure;
  return failure && failure.scope === scope && name in failure.values ? failure.values[name] : fallback;
}
// The refusal for this form, when this form is the one that was refused.
export function failureFor(scope: string): FormFailure | null {
  const failure = requestState.getStore()?.failure;
  return failure && failure.scope === scope ? failure : null;
}
