import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme.dart';

/// A block of an assistant answer. Exported for tests.
sealed class MdBlock {
  const MdBlock();
}

class MdHeading extends MdBlock {
  const MdHeading(this.level, this.text);
  final int level;
  final String text;
}

class MdParagraph extends MdBlock {
  const MdParagraph(this.text);
  final String text;
}

class MdListItem extends MdBlock {
  const MdListItem(this.text, {this.number, this.depth = 0});
  final String text;

  /// The item number for ordered lists, null for bullets.
  final int? number;
  final int depth;
}

class MdQuote extends MdBlock {
  const MdQuote(this.text);
  final String text;
}

class MdCode extends MdBlock {
  const MdCode(this.text);
  final String text;
}

class MdRule extends MdBlock {
  const MdRule();
}

final _heading = RegExp(r'^(#{1,6})\s+(.*)$');
final _bullet = RegExp(r'^(\s*)[-*•+]\s+(.*)$');
final _numbered = RegExp(r'^(\s*)(\d{1,3})[.)]\s+(.*)$');
final _rule = RegExp(r'^\s*([-*_])(\s*\1){2,}\s*$');

/// Splits Markdown into the blocks the chat renders. Exported for tests.
List<MdBlock> parseMarkdown(String source) {
  final blocks = <MdBlock>[];
  final paragraph = <String>[];
  final quote = <String>[];
  void flush() {
    if (paragraph.isNotEmpty) {
      blocks.add(MdParagraph(paragraph.join(' ')));
      paragraph.clear();
    }
    if (quote.isNotEmpty) {
      blocks.add(MdQuote(quote.join(' ')));
      quote.clear();
    }
  }

  final lines = source.replaceAll('\r\n', '\n').split('\n');
  for (var index = 0; index < lines.length; index++) {
    final line = lines[index];
    final trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      flush();
      final code = <String>[];
      while (++index < lines.length && !lines[index].trim().startsWith('```')) {
        code.add(lines[index]);
      }
      blocks.add(MdCode(code.join('\n')));
      continue;
    }
    if (trimmed.isEmpty) {
      flush();
      continue;
    }
    final heading = _heading.firstMatch(trimmed);
    if (heading != null) {
      flush();
      blocks.add(MdHeading(heading[1]!.length, heading[2]!.trim()));
      continue;
    }
    if (_rule.hasMatch(trimmed)) {
      flush();
      blocks.add(const MdRule());
      continue;
    }
    if (trimmed.startsWith('>')) {
      if (paragraph.isNotEmpty) flush();
      quote.add(trimmed.replaceFirst(RegExp(r'^>\s?'), ''));
      continue;
    }
    final numbered = _numbered.firstMatch(line);
    if (numbered != null) {
      flush();
      blocks.add(MdListItem(numbered[3]!.trim(),
          number: int.parse(numbered[2]!),
          depth: (numbered[1]!.length ~/ 2).clamp(0, 3)));
      continue;
    }
    final bullet = _bullet.firstMatch(line);
    if (bullet != null) {
      flush();
      blocks.add(MdListItem(bullet[2]!.trim(),
          depth: (bullet[1]!.length ~/ 2).clamp(0, 3)));
      continue;
    }
    if (quote.isNotEmpty) flush();
    paragraph.add(trimmed);
  }
  flush();
  return blocks;
}

final _inline = RegExp(r'(\*\*|__|~~|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*)');

/// Inline Markdown (bold, italic, strike, code, links) as text spans.
List<InlineSpan> inlineSpans(String text, TextStyle base,
    {void Function(Uri uri)? onLink}) {
  final spans = <InlineSpan>[];
  var bold = false, italic = false, strike = false;
  var position = 0;
  TextStyle style() => base.copyWith(
      fontWeight: bold ? FontWeight.w700 : base.fontWeight,
      fontStyle: italic ? FontStyle.italic : base.fontStyle,
      color: bold ? Colors.white : base.color,
      decoration: strike ? TextDecoration.lineThrough : base.decoration);
  void add(String value) {
    if (value.isNotEmpty) spans.add(TextSpan(text: value, style: style()));
  }

  for (final match in _inline.allMatches(text)) {
    add(text.substring(position, match.start));
    position = match.end;
    final token = match[0]!;
    if (token == '**' || token == '__') {
      bold = !bold;
    } else if (token == '~~') {
      strike = !strike;
    } else if (token == '*') {
      italic = !italic;
    } else if (token.startsWith('`')) {
      spans.add(TextSpan(
          text: token.substring(1, token.length - 1),
          style: style().copyWith(
              fontFamily: 'monospace',
              fontSize: (base.fontSize ?? 15) * .92,
              backgroundColor: const Color(0x33FFFFFF))));
    } else {
      final link = RegExp(r'^\[([^\]]+)\]\(([^)\s]+)\)$').firstMatch(token)!;
      final uri = Uri.tryParse(link[2]!);
      final safe = uri != null && uri.scheme == 'https';
      spans.add(TextSpan(
          text: link[1],
          style: style().copyWith(
              color: kPink, decoration: safe ? TextDecoration.underline : null),
          recognizer: safe && onLink != null
              ? (TapGestureRecognizer()..onTap = () => onLink(uri))
              : null));
    }
  }
  add(text.substring(position));
  return spans;
}

/// Renders an assistant answer written in Markdown, ChatGPT style.
class MarkdownText extends StatelessWidget {
  const MarkdownText(this.source, {super.key});
  final String source;

  static const _body =
      TextStyle(fontSize: 15, height: 1.55, color: Color(0xFFE4E1EC));

  void _open(Uri uri) => launchUrl(uri, mode: LaunchMode.externalApplication);

  Widget _rich(String text, TextStyle style) =>
      Text.rich(TextSpan(children: inlineSpans(text, style, onLink: _open)));

  Widget _block(MdBlock block, MdBlock? previous) => switch (block) {
        MdHeading(:final level, :final text) => Padding(
            padding: EdgeInsets.only(top: previous == null ? 0 : 14, bottom: 6),
            child: _rich(
                text,
                _body.copyWith(
                    fontSize: level <= 1
                        ? 21
                        : level == 2
                            ? 18.5
                            : 16.5,
                    height: 1.3,
                    fontWeight: FontWeight.w800,
                    color: Colors.white))),
        MdParagraph(:final text) => Padding(
            padding: EdgeInsets.only(top: previous == null ? 0 : 8),
            child: _rich(text, _body)),
        MdListItem(:final text, :final number, :final depth) => Padding(
            padding: EdgeInsets.only(
                top: previous is MdListItem ? 7 : (previous == null ? 0 : 10),
                left: depth * 18.0),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(
                width: number == null ? 18 : 26,
                child: number == null
                    ? const Padding(
                        padding: EdgeInsets.only(top: 9, left: 4),
                        child:
                            CircleAvatar(radius: 2.6, backgroundColor: kPink))
                    : Text('$number.',
                        style: _body.copyWith(
                            fontWeight: FontWeight.w700, color: kPink)),
              ),
              Expanded(child: _rich(text, _body)),
            ])),
        MdQuote(:final text) => Container(
            margin: const EdgeInsets.only(top: 10),
            padding: const EdgeInsets.fromLTRB(12, 6, 8, 6),
            decoration: const BoxDecoration(
                border: Border(left: BorderSide(color: kPink, width: 3))),
            child: _rich(text,
                _body.copyWith(color: kMuted, fontStyle: FontStyle.italic))),
        MdCode(:final text) => Container(
            width: double.infinity,
            margin: const EdgeInsets.only(top: 10),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
                color: const Color(0xFF0B0B0E),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0x22FFFFFF))),
            child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Text(text,
                    style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 13,
                        height: 1.45,
                        color: Color(0xFFE4E1EC))))),
        MdRule() => const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Divider(height: 1, color: Color(0x22FFFFFF))),
      };

  @override
  Widget build(BuildContext context) {
    final blocks = parseMarkdown(source);
    return SelectionArea(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (var index = 0; index < blocks.length; index++)
          _block(blocks[index], index == 0 ? null : blocks[index - 1]),
      ]),
    );
  }
}
