import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

// Single-event reminder. Rendered to both HTML and plain-text via
// @react-email/render — keep markup simple so the plain-text fallback reads
// well too.
export function ReminderEmail({
  title,
  whenDisplay,
  notes,
  eventLink,
}: {
  title: string;
  whenDisplay: string;
  notes: string | null;
  eventLink: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{`${title} — ${whenDisplay}`}</Preview>
      <Body style={{ fontFamily: "system-ui, sans-serif", padding: "24px" }}>
        <Container style={{ maxWidth: 480 }}>
          <Heading style={{ fontSize: 20, marginBottom: 8 }}>{title}</Heading>
          <Text style={{ marginTop: 0, color: "#444" }}>{whenDisplay}</Text>
          {notes && (
            <Section style={{ marginTop: 16 }}>
              <Text style={{ whiteSpace: "pre-wrap" }}>{notes}</Text>
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
              Open in calendar
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default ReminderEmail;
