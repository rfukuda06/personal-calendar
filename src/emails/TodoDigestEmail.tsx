import {
  Body,
  Container,
  Head,
  Html,
} from "@react-email/components";

export function TodoDigestEmail({
  todos,
}: {
  todos: { title: string }[];
}) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "system-ui, sans-serif", padding: "24px" }}>
        <Container style={{ maxWidth: 480 }}>
          <ul style={{ paddingLeft: 20, marginTop: 0 }}>
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
