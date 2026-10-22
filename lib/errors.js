// Named SQL errors -> HTTP status + a message customers understand.
// Raw database text never reaches the browser.
const MAP = {
  SLOT_TAKEN:              [409, 'Someone just booked this slot. Please pick another time.'],
  ACTIVE_HOLD_EXISTS:      [409, 'You already have a slot on hold. Finish that booking or wait a few minutes.'],
  OUTSIDE_SCHEDULE:        [400, 'That time isn’t available.'],
  SLOT_IN_PAST:            [400, 'That time has already passed.'],
  TOO_FAR_AHEAD:           [400, 'That date is too far ahead.'],
  CUSTOMER_BLOCKED:        [403, 'Online booking isn’t available for this number. Please call the salon.'],
  STAFF_CANNOT_DO_SERVICE: [404, 'Not found.'],
  SERVICE_NOT_FOUND:       [404, 'Not found.'],
  BUSINESS_NOT_FOUND:      [404, 'Not found.'],
  NO_GAP_TODAY:            [409, 'The queue is full for today. Book online for another day?'],
  QUEUE_BUSY:              [503, 'Lots of people joining right now. Please try again.'],
  WALKIN_ALREADY_QUEUED:   [409, 'You’re already in the queue.'],
  HOLD_TOO_LATE:           [409, 'Your hold is about to run out. Please pick the slot again.'],
  HOLD_EXPIRED:            [409, 'Your hold has expired. Please pick a slot again.'],
  HOLD_NOT_FOUND:          [409, 'Your hold has expired. Please pick a slot again.'],
};

export function toHttp(error) {
  const code = error?.message;
  const [status, message] = MAP[code] ?? [500, 'Something went wrong.'];
  return { status, body: { error: MAP[code] ? code : 'INTERNAL', message } };
}

export const json = (status, body) => Response.json(body, { status });
export const fail = (status, error, message) => json(status, { error, message });
