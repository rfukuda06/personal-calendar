import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Section,
  Text,
} from "@react-email/components";

// Per-event reminder body. The subject line carries just the title; the body
// shows the time/day, notes (if any), and a link that opens the event's day
// view in the calendar.
export function ReminderEmail({
  whenDisplay,
  notes,
  eventLink,
}: {
  whenDisplay: string;
  notes: string | null;
  eventLink: string;
}) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "system-ui, sans-serif", padding: "24px" }}>
        <Container style={{ maxWidth: 480 }}>
          <Section>
            <Text style={{ marginTop: 0, fontWeight: 600 }}>
              {whenDisplay}
            </Text>
          </Section>
          {notes && (
            <Section>
              <Text style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>
                {notes}
              </Text>
            </Section>
          )}
          <Section style={{ marginTop: 24 }}>
            <Button
              href={eventLink}
              style={{
                background: "#111",
                color: "#fff",
                padding: "10px 16px",
                borderRadius: 6,
                textDecoration: "none",
                fontSize: 14,
              }}
            >
              [Open in calendar]
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default ReminderEmail;
