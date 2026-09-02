const assert = require('assert');
const DateParser = require('../dateParser.js');
const { parseDateFromText, parseTimeFromText, parseTimeInfoVerbose, parseLocationFromText, formatLocalDate } = DateParser;

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

// Wednesday, 2026-09-02 10:00 local
const base = new Date(2026, 8, 2, 10, 0, 0);

check('today', () => {
  const d = parseDateFromText('Let\'s meet today', base);
  assert.strictEqual(formatLocalDate(d), '2026-09-02');
});

check('tomorrow', () => {
  const d = parseDateFromText('See you tomorrow', base);
  assert.strictEqual(formatLocalDate(d), '2026-09-03');
});

check('MM/DD (assumes current year)', () => {
  const d = parseDateFromText('The event is on 7/25', base);
  assert.strictEqual(formatLocalDate(d), '2026-07-25');
});

check('MM/DD/YYYY', () => {
  const d = parseDateFromText('The event is on 7/25/2027', base);
  assert.strictEqual(formatLocalDate(d), '2027-07-25');
});

check('Month Day, same-day comparison does not falsely roll year', () => {
  const d = parseDateFromText('Join us September 2nd for lunch', base);
  assert.strictEqual(formatLocalDate(d), '2026-09-02');
});

check('Month Day rolls to next year when already past', () => {
  const d = parseDateFromText('Join us January 5th for lunch', base);
  assert.strictEqual(formatLocalDate(d), '2027-01-05');
});

check('abbreviated weekday (Mon)', () => {
  const d = parseDateFromText('Catch up Mon at 2pm', base);
  // base is Wed 2026-09-02, next Monday is 2026-09-07
  assert.strictEqual(formatLocalDate(d), '2026-09-07');
});

check('fuzzy full weekday with typo', () => {
  const d = parseDateFromText('Lets meet Frday afternoon', base);
  assert.strictEqual(formatLocalDate(d), '2026-09-04'); // next Friday
});

check('"next" weekday skips a week', () => {
  const d = parseDateFromText('Lets meet next Friday afternoon', base);
  assert.strictEqual(formatLocalDate(d), '2026-09-11');
});

check('explicit numeric date wins over incidental weekday word', () => {
  const d = parseDateFromText('Order #12/25 will ship Friday, delivery on 10/15/2026', base);
  assert.strictEqual(formatLocalDate(d), '2026-10-15');
});

check('invalid day-of-month is rejected (Feb 30 style rollover)', () => {
  const d = parseDateFromText('Deadline is 2/30', base);
  assert.strictEqual(d, null);
});

check('time: "at 3pm"', () => {
  assert.strictEqual(parseTimeFromText('Meet at 3pm'), '15:00');
});

check('time: 10:00 AM', () => {
  assert.strictEqual(parseTimeFromText('Starts 10:00 AM sharp'), '10:00');
});

check('time: noon', () => {
  assert.strictEqual(parseTimeFromText('Lunch at noon'), '12:00');
});

check('time: bare 24h-looking H:MM without am/pm outside 1-12 is ignored', () => {
  assert.strictEqual(parseTimeFromText('Ref code 14:52'), null);
});

check('labeled "When:" date outranks an incidental number elsewhere in the body', () => {
  const text = 'Reminder: invoice 3/10 is due.\nWhen: 9/20/2026 at 2pm\nThanks';
  const d = parseDateFromText(text, base);
  assert.strictEqual(formatLocalDate(d), '2026-09-20');
});

check('"Date:"/"Time:" labels are combined and outrank incidental numbers', () => {
  const text = 'Order 12/01 shipped.\nDate: 9/20/2026\nTime: 2-3:30pm\nSee you there';
  const d = parseDateFromText(text, base);
  const info = parseTimeInfoVerbose(text);
  assert.strictEqual(formatLocalDate(d), '2026-09-20');
  assert.strictEqual(info.time, '14:00');
  assert.strictEqual(info.range.end, '15:30');
});

check('time range "2-4pm" -> 14:00-16:00, 120 min', () => {
  const info = parseTimeInfoVerbose('Meeting from 2-4pm');
  assert.strictEqual(info.time, '14:00');
  assert.strictEqual(info.range.end, '16:00');
  assert.strictEqual(info.range.durationMinutes, 120);
});

check('time range with explicit am/pm and minutes on both ends', () => {
  const info = parseTimeInfoVerbose('Call 10:00 AM - 11:30 AM to discuss');
  assert.strictEqual(info.time, '10:00');
  assert.strictEqual(info.range.end, '11:30');
  assert.strictEqual(info.range.durationMinutes, 90);
});

check('time range "11-4pm" infers an am start before a pm end', () => {
  const info = parseTimeInfoVerbose('Available 11-4pm today');
  assert.strictEqual(info.time, '11:00');
  assert.strictEqual(info.range.end, '16:00');
});

check('bare numeric range without am/pm or colon is not mistaken for a time', () => {
  const info = parseTimeInfoVerbose('See page 9-11 for details');
  assert.strictEqual(info.range, null);
});

check('single time still works when no range syntax is present', () => {
  const info = parseTimeInfoVerbose('Meet at 3pm');
  assert.strictEqual(info.time, '15:00');
  assert.strictEqual(info.range, null);
});

check('debug: date candidates list marks a winner with source and label', () => {
  const verbose = DateParser.parseDateFromTextVerbose('When: 9/20/2026\nAlso mentions 3/10 elsewhere', base);
  const winner = verbose.candidates.find(c => c.isWinner);
  assert.ok(winner, 'expected a winning candidate');
  assert.strictEqual(winner.dateLabel, '2026-09-20');
  assert.ok(winner.source.startsWith('label:'), `expected label source, got ${winner.source}`);
});

check('abbreviated month with explicit year', () => {
  const d = parseDateFromText('Date: Aug 27th, 2026', base);
  assert.strictEqual(formatLocalDate(d), '2026-08-27');
});

check('abbreviated month without a year rolls to next year when already past', () => {
  const d = parseDateFromText('Reminder: Apr 24 works for you?', base);
  assert.strictEqual(formatLocalDate(d), '2027-04-24');
});

check('regression: "Date: Thursday, Aug 27th, 2026" resolves to the labeled abbreviated-month date, not the fuzzy weekday or the RSVP deadline', () => {
  const text = [
    'Please join us for the mixer!',
    'Date: Thursday, Aug 27th, 2026',
    'Time: 5-7PM',
    'RSVP by 8/25/26 11:59PM to secure your seat for this event!'
  ].join('\n');
  const d = parseDateFromText(text, base);
  assert.strictEqual(formatLocalDate(d), '2026-08-27');

  const info = parseTimeInfoVerbose(text);
  assert.strictEqual(info.time, '17:00');
  assert.strictEqual(info.range.end, '19:00');
});

check('regression: Google Calendar invite "When" label on its own line, date+range on the next', () => {
  const text = [
    'When',
    'Friday Apr 24, 2026 ⋅ 1:30pm – 2:30pm (Eastern Time - New York)',
    'Guests',
    'organizer@example.com - organizer',
    'guest@example.com'
  ].join('\n');
  const d = parseDateFromText(text, base);
  assert.strictEqual(formatLocalDate(d), '2026-04-24');

  const info = parseTimeInfoVerbose(text);
  assert.strictEqual(info.time, '13:30');
  assert.strictEqual(info.range.end, '14:30');
  assert.strictEqual(info.range.durationMinutes, 60);
  assert.strictEqual(info.source, 'label:when');
});

check('regression: "(Eastern Time - New York)" is not mistaken for a "Time:" label', () => {
  const text = 'Friday Apr 24, 2026 ⋅ 1:30pm – 2:30pm (Eastern Time - New York)';
  const info = parseTimeInfoVerbose(text);
  assert.strictEqual(info.time, '13:30');
  assert.strictEqual(info.range.end, '14:30');
});

check('narrow "on <weekday>" fallback outranks an incidental unlabeled number', () => {
  const text = "Let's catch up on Friday to finalize things. FYI order 12/25 shipped.";
  const verbose = DateParser.parseDateFromTextVerbose(text, base);
  const winner = verbose.candidates.find(c => c.isWinner);
  assert.strictEqual(winner.dateLabel, '2026-09-04');
  assert.ok(winner.source.startsWith('label:on'), `expected on-fallback source, got ${winner.source}`);
});

check('narrow "on <month day>" fallback recognizes abbreviated months', () => {
  const d = parseDateFromText('Please stop by on Aug 27 to pick it up.', base);
  assert.strictEqual(formatLocalDate(d), '2027-08-27');
});

check('location: labeled "Location:" line is used directly, including a name + street address', () => {
  const info = parseLocationFromText('Location: Options Center, 352 W 110th St, New York, NY 10025');
  assert.strictEqual(info.location, 'Options Center, 352 W 110th St, New York, NY 10025');
  assert.strictEqual(info.source, 'label:location');
  assert.strictEqual(info.meetingLink, null);
});

check('location: a Zoom link anywhere in the body sets location to Online and surfaces the link', () => {
  const info = parseLocationFromText('Join Zoom Meeting https://zoom.us/j/1234567890?pwd=abc123\nMeeting ID: 123 456 7890');
  assert.strictEqual(info.location, 'Online');
  assert.strictEqual(info.meetingLink, 'https://zoom.us/j/1234567890?pwd=abc123');
  assert.strictEqual(info.source, 'meeting-link');
});

check('location: Google Meet and Teams links are also recognized as Online', () => {
  assert.strictEqual(parseLocationFromText('https://meet.google.com/abc-defg-hij').location, 'Online');
  assert.strictEqual(parseLocationFromText('https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc').location, 'Online');
});

check('location: a "Where:" label whose content lacks a comma before the city still comes through whole', () => {
  const info = parseLocationFromText('Where: 1 Pace Plaza, Main Lobby New York, NY 10038');
  assert.strictEqual(info.location, '1 Pace Plaza, Main Lobby New York, NY 10038');
});

check('location: freeform street address is recognized without any label', () => {
  const info = parseLocationFromText('We will meet at 352 W 110th St, New York, NY 10025 for the event.');
  assert.strictEqual(info.location, '352 W 110th St, New York, NY 10025');
  assert.strictEqual(info.source, 'address-pattern');
});

check('location: no signal found is left blank rather than defaulting to "Online"', () => {
  const info = parseLocationFromText('No location info here at all.');
  assert.strictEqual(info.location, null);
});

check('regression: full mixer email resolves date, time, and location together', () => {
  const base = new Date(2026, 7, 27, 9, 53, 0);
  const text = [
    'Make sure to join the Success Team this evening for a fun filled mixer and meet.',
    'Registration closes today at 12pm.',
    '',
    'Options Success Team invites you to join our Welcome Back Mixer!',
    '',
    'Date: Thursday, Aug 27th, 2026',
    '',
    'Time: 5-7PM',
    '',
    'Location: Options Center, 352 W 110th St, New York, NY 10025',
    '',
    'RSVP by 8/25/26 11:59PM to secure your seat for this event!'
  ].join('\n');

  const d = parseDateFromText(text, base);
  assert.strictEqual(formatLocalDate(d), '2026-08-27');

  const timeInfo = parseTimeInfoVerbose(text);
  assert.strictEqual(timeInfo.time, '17:00');
  assert.strictEqual(timeInfo.range.end, '19:00');

  const locationInfo = parseLocationFromText(text);
  assert.strictEqual(locationInfo.location, 'Options Center, 352 W 110th St, New York, NY 10025');
});

check('regression: a bare "on Tuesday" mention cannot outrank an unlabeled, more precise date elsewhere', () => {
  const base = new Date(2025, 5, 20, 15, 54, 0);
  const text = 'Ryan health referral scheduled on Tuesday. Jul 1, 2025 is the confirmed date separately mentioned.';
  const d = parseDateFromText(text, base);
  assert.strictEqual(formatLocalDate(d), '2025-07-01');
});

check('regression: "When" label separated from its content by several blank lines (nested table markup) is still found', () => {
  const base = new Date(2025, 5, 20, 15, 54, 0);
  const text = [
    'Ryan health. David. Examen medico general. Referidos.',
    '', '', '',
    'When',
    '', '', '',
    'Tuesday Jul 1, 2025 ⋅ 3pm – 4:30pm (Eastern Time - New York)',
    '',
    'Guests',
    '',
    'Jane Doe - organizer',
    'guest@example.com'
  ].join('\n');

  const verbose = DateParser.parseDateFromTextVerbose(text, base);
  const winner = verbose.candidates.find(c => c.isWinner);
  assert.strictEqual(winner.dateLabel, '2025-07-01');
  assert.strictEqual(winner.source, 'label:when');

  const timeInfo = parseTimeInfoVerbose(text);
  assert.strictEqual(timeInfo.time, '15:00');
  assert.strictEqual(timeInfo.range.end, '16:30');
});

console.log(`\n${passed} test(s) passed`);
