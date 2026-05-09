import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";

export function TodoDigestEmail({
  dateDisplay,
  todos,
}: {
  dateDisplay: string;
  todos: { title: string }[];
}) {
  const count = todos.length;
  return (
    <Html>
      <Head />
      <Preview>{`You have ${count} todo${count === 1 ? "" : "s"} today`}</Preview>
      <Body style={{ fontFamily: "system-ui, sans-serif", padding: "24px" }}>
        <Container style={{ maxWidth: 480 }}>
          <Heading style={{ fontSize: 20, marginBottom: 8 }}>
            {`You have ${count} todo${count === 1 ? "" : "s"} today`}
          </Heading>
          <Text style={{ marginTop: 0, color: "#444" }}>{dateDisplay}</Text>
          <ul style={{ paddingLeft: 20, marginTop: 16 }}>
            {todos.map((t, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {t.title}
              </li>
            ))}
          </ul>
        </Container>
      </Body>
    </Html>
  );
}

export default TodoDigestEmail;
