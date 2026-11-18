import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexo/domain/entities/assistant.dart';
import 'package:nexo/features/assistant/markdown_text.dart';

void main() {
  test('Markdown answers split into headings, lists, quotes and paragraphs',
      () {
    final blocks = parseMarkdown('''Here are this week's picks:

### Movies
1. **The Odyssey** (2026) — ⭐ 8.0 · Adventure
2. **Avengers: Doomsday** (2026) — Sci-Fi
- **Godzilla Minus Zero** (2026)
  - nested note
> A quote

*Want more like these?*''');
    expect(blocks[0], isA<MdParagraph>());
    expect(blocks[1], isA<MdHeading>().having((b) => b.level, 'level', 3));
    expect(blocks[2], isA<MdListItem>().having((b) => b.number, 'number', 1));
    expect(blocks[3], isA<MdListItem>().having((b) => b.number, 'number', 2));
    expect(
        blocks[4], isA<MdListItem>().having((b) => b.number, 'number', null));
    expect(blocks[5], isA<MdListItem>().having((b) => b.depth, 'depth', 1));
    expect(blocks[6], isA<MdQuote>());
    expect(blocks[7], isA<MdParagraph>());
  });

  test('inline Markdown turns into bold, italic and plain spans', () {
    final spans = inlineSpans(
            '**The Odyssey** (2026) — *epic*', const TextStyle(fontSize: 15))
        .cast<TextSpan>();
    expect(
        spans.map((span) => span.text), ['The Odyssey', ' (2026) — ', 'epic']);
    expect(spans[0].style!.fontWeight, FontWeight.w700);
    expect(spans[2].style!.fontStyle, FontStyle.italic);
  });

  test('chats survive a round trip through storage', () {
    final chat = AssistantChat(
        id: '1',
        title: AssistantChat.titleFor(const [
          AssistantMessage(role: 'user', content: 'What movies are trending?')
        ]),
        updatedAt: DateTime(2026, 11, 18),
        messages: const [
          AssistantMessage(role: 'user', content: 'What movies are trending?'),
          AssistantMessage(
              role: 'assistant',
              content: '**The Odyssey**',
              remembered: ['Likes epics']),
        ]);
    final restored = AssistantChat.fromStorage(chat.toStorage())!;
    expect(restored.title, 'What movies are trending?');
    expect(restored.messages.last.remembered, ['Likes epics']);
    expect(restored.messages.first.toJson(),
        {'role': 'user', 'content': 'What movies are trending?'});
  });

  test('API replies carry remembered facts', () {
    final reply = AssistantMessage.fromReply({
      'reply': 'Noted!',
      'items': <dynamic>[],
      'remembered': ['Supports Barcelona', ' ']
    });
    expect(reply.remembered, ['Supports Barcelona']);
  });
}
