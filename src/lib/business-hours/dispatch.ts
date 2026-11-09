/**
 * An existing flow is allowed to finish; outside opening hours no new flow
 * may start and other inbound responders must remain quiet.
 */
export async function dispatchWithBusinessHours(args: {
  closed: boolean
  runFlow: (allowNewRuns: boolean) => Promise<boolean>
  sendNotice: () => Promise<void>
  runOtherResponders: (flowConsumed: boolean) => Promise<void>
}): Promise<void> {
  const consumed = await args.runFlow(!args.closed)
  if (args.closed) {
    if (!consumed) await args.sendNotice()
    return
  }
  await args.runOtherResponders(consumed)
}
