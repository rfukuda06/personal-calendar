import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Section,
  Text,
} from "@react-email/components";

// Per-event reminder body. The subject line carries the title and time, so
// the body just shows notes (if any) and a link that opens the event's day
// view in the calendar.
export function ReminderEmail({
  notes,
  eventLink,
}: {
  notes: string | null;
  eventLink: string;
}) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "system-ui, sans-serif", padding: "24px" }}>
        <Container style={{ maxWidth: 480 }}>
          {notes && (
            <Section>
              <Text style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>
                {notes}
              </Text>
            </Section>
          )}
          <Section style={{ marginTop: notes ? 24 : 0 }}>
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
              Open in calendar
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default ReminderEmail;
