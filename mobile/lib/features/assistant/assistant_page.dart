import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../core/theme.dart';
import '../../domain/entities/assistant.dart';
import '../../domain/entities/catalog_item.dart';
import '../catalog/catalog_cubit.dart';
import '../shared/widgets.dart';

const _suggestions = [
  (
    icon: Icons.local_fire_department_outlined,
    text: 'What movies are trending this week?'
  ),
  (icon: Icons.favorite_border, text: 'Suggest a new Korean drama to start'),
  (icon: Icons.sports_soccer, text: "What's live in sports right now?"),
  (
    icon: Icons.play_circle_outline,
    text: 'Show me full episodes I can watch free'
  ),
  (icon: Icons.tv, text: 'Best web series of 2026 so far?'),
  (icon: Icons.movie_filter_outlined, text: 'A feel-good movie for tonight'),
];

/// NEXO Assistant: a chat that answers from live NEXO data.
class AssistantPage extends StatefulWidget {
  const AssistantPage({super.key});
  @override
  State<AssistantPage> createState() => _AssistantPageState();
}

class _AssistantPageState extends State<AssistantPage> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _focus = FocusNode();
  final _messages = <AssistantMessage>[];
  bool _waiting = false;
  String? _error;

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _scrollToEnd() => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.animateTo(_scroll.position.maxScrollExtent,
              duration: const Duration(milliseconds: 250),
              curve: Curves.easeOut);
        }
      });

  Future<void> _send([String? preset]) async {
    final text = (preset ?? _input.text).trim();
    if (text.isEmpty || _waiting) return;
    _input.clear();
    setState(() {
      _messages.add(AssistantMessage(role: 'user', content: text));
      _waiting = true;
      _error = null;
    });
    await _ask();
  }

  Future<void> _ask() async {
    _scrollToEnd();
    try {
      final reply = await context.read<CatalogCubit>().repository.askAssistant(
          List.of(_messages),
          region:
              WidgetsBinding.instance.platformDispatcher.locale.countryCode);
      if (!mounted) return;
      setState(() => _messages.add(reply));
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error is AssistantException
          ? error.message
          : 'Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => _waiting = false);
      _scrollToEnd();
    }
  }

  void _retry() {
    if (_waiting || _messages.isEmpty || !_messages.last.fromUser) return;
    setState(() {
      _waiting = true;
      _error = null;
    });
    _ask();
  }

  void _newChat() => setState(() {
        _messages.clear();
        _error = null;
        _waiting = false;
      });

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: kBg,
        appBar: AppBar(
          backgroundColor: kBg,
          scrolledUnderElevation: 0,
          titleSpacing: 18,
          title: const Row(children: [
            _AssistantAvatar(size: 30),
            SizedBox(width: 10),
            Text('NEXO AI',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          ]),
          actions: [
            if (_messages.isNotEmpty)
              IconButton(
                  tooltip: 'New chat',
                  onPressed: _waiting ? null : _newChat,
                  icon: const Icon(Icons.edit_square)),
            const SizedBox(width: 6),
          ],
        ),
        body: SafeArea(
          top: false,
          child: Column(children: [
            Expanded(
                child: _messages.isEmpty
                    ? _Welcome(onPick: _send)
                    : ListView.builder(
                        controller: _scroll,
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                        itemCount: _messages.length + 1,
                        itemBuilder: (context, index) {
                          if (index < _messages.length) {
                            final message = _messages[index];
                            return message.fromUser
                                ? _UserBubble(text: message.content)
                                : _AssistantBubble(message: message);
                          }
                          if (_waiting) return const _Typing();
                          if (_error != null) {
                            return _ErrorRow(message: _error!, onRetry: _retry);
                          }
                          return const SizedBox(height: 4);
                        })),
            _Composer(
                controller: _input,
                focusNode: _focus,
                busy: _waiting,
                onSend: _send),
          ]),
        ),
      );
}

class _AssistantAvatar extends StatelessWidget {
  const _AssistantAvatar({this.size = 28});
  final double size;
  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: const BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(
                colors: [kPink, Color(0xFF7B5CFF)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight)),
        child: Icon(Icons.auto_awesome, size: size * .55, color: Colors.white),
      );
}

class _Welcome extends StatelessWidget {
  const _Welcome({required this.onPick});
  final ValueChanged<String> onPick;
  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.fromLTRB(18, 28, 18, 18),
        children: [
          const Center(child: _AssistantAvatar(size: 64)),
          const SizedBox(height: 18),
          const Text('What do you want to watch?',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          const Text(
              'Ask about movies, dramas, web series and sports. Answers use the latest NEXO data.',
              textAlign: TextAlign.center,
              style: TextStyle(color: kMuted, height: 1.4)),
          const SizedBox(height: 26),
          for (final suggestion in _suggestions)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Material(
                color: kPanel,
                borderRadius: BorderRadius.circular(14),
                child: InkWell(
                  borderRadius: BorderRadius.circular(14),
                  onTap: () => onPick(suggestion.text),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 14),
                    child: Row(children: [
                      Icon(suggestion.icon, size: 20, color: kPink),
                      const SizedBox(width: 12),
                      Expanded(
                          child: Text(suggestion.text,
                              style: const TextStyle(
                                  fontSize: 15, fontWeight: FontWeight.w600))),
                      const Icon(Icons.north_east, size: 16, color: kMuted),
                    ]),
                  ),
                ),
              ),
            ),
        ],
      );
}

class _UserBubble extends StatelessWidget {
  const _UserBubble({required this.text});
  final String text;
  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.only(top: 10, bottom: 6, left: 48),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: const BoxDecoration(
              color: Color(0xFF2C2A35),
              borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(18),
                  topRight: Radius.circular(18),
                  bottomLeft: Radius.circular(18),
                  bottomRight: Radius.circular(4))),
          child: SelectableText(text,
              style: const TextStyle(fontSize: 15, height: 1.4)),
        ),
      );
}

class _AssistantBubble extends StatelessWidget {
  const _AssistantBubble({required this.message});
  final AssistantMessage message;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 10, bottom: 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Padding(
                padding: EdgeInsets.only(top: 2), child: _AssistantAvatar()),
            const SizedBox(width: 10),
            Expanded(
                child: SelectableText(message.content,
                    style: const TextStyle(
                        fontSize: 15, height: 1.5, color: Color(0xFFECEAF2)))),
          ]),
          if (message.items.isNotEmpty) ...[
            const SizedBox(height: 12),
            _ResultCards(items: message.items),
          ],
          Padding(
            padding: const EdgeInsets.only(left: 30, top: 2),
            child: IconButton(
                tooltip: 'Copy',
                visualDensity: VisualDensity.compact,
                iconSize: 18,
                color: kMuted,
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: message.content));
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                      content: Text('Copied'), duration: Duration(seconds: 1)));
                },
                icon: const Icon(Icons.copy_rounded)),
          ),
        ]),
      );
}

/// The titles an answer mentions: posters for movies and series, thumbnails
/// for videos. Tapping one opens its details page or the player.
class _ResultCards extends StatelessWidget {
  const _ResultCards({required this.items});
  final List<CatalogItem> items;
  @override
  Widget build(BuildContext context) {
    final wide = items.every((item) => item.posterUrl == null);
    final width = wide ? 200.0 : 112.0;
    final height = wide ? width * 9 / 16 : width * 1.5;
    return SizedBox(
      height: height + 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.only(left: 38),
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (context, index) {
          final item = items[index];
          return SizedBox(
            width: width,
            child: InkWell(
              borderRadius: BorderRadius.circular(6),
              onTap: () => openItem(context, item),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: SizedBox(
                            width: width,
                            height: height,
                            child: Artwork(
                                url: wide
                                    ? item.wideImage
                                    : item.posterUrl ?? item.wideImage,
                                label: item.name,
                                cacheWidth: (width * 3).round()))),
                    const SizedBox(height: 6),
                    Text(item.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 12,
                            height: 1.25,
                            fontWeight: FontWeight.w600)),
                  ]),
            ),
          );
        },
      ),
    );
  }
}

class _Typing extends StatefulWidget {
  const _Typing();
  @override
  State<_Typing> createState() => _TypingState();
}

class _TypingState extends State<_Typing> with SingleTickerProviderStateMixin {
  late final _controller = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 1100))
    ..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 10),
        child: Row(children: [
          const _AssistantAvatar(),
          const SizedBox(width: 12),
          AnimatedBuilder(
            animation: _controller,
            builder: (context, _) => Row(children: [
              for (var dot = 0; dot < 3; dot++)
                Container(
                  margin: const EdgeInsets.only(right: 5),
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.white.withValues(
                          alpha: .25 +
                              .6 *
                                  (1 -
                                      ((_controller.value * 3 - dot) % 3)
                                          .clamp(0, 1)
                                          .toDouble()))),
                ),
            ]),
          ),
          const SizedBox(width: 6),
          const Text('Looking it up…',
              style: TextStyle(color: kMuted, fontSize: 13)),
        ]),
      );
}

class _ErrorRow extends StatelessWidget {
  const _ErrorRow({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(top: 12),
        padding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
        decoration: BoxDecoration(
            color: const Color(0x22FF5470),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0x55FF5470))),
        child: Row(children: [
          const Icon(Icons.error_outline, size: 18, color: Color(0xFFFF8A9B)),
          const SizedBox(width: 10),
          Expanded(
              child: Text(message,
                  style: const TextStyle(fontSize: 13, height: 1.35))),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ]),
      );
}

class _Composer extends StatefulWidget {
  const _Composer(
      {required this.controller,
      required this.focusNode,
      required this.busy,
      required this.onSend});
  final TextEditingController controller;
  final FocusNode focusNode;
  final bool busy;
  final ValueChanged<String?> onSend;
  @override
  State<_Composer> createState() => _ComposerState();
}

class _ComposerState extends State<_Composer> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    super.dispose();
  }

  void _changed() => setState(() {});

  @override
  Widget build(BuildContext context) {
    final canSend = !widget.busy && widget.controller.text.trim().isNotEmpty;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
      decoration: const BoxDecoration(
          color: kBg,
          border: Border(top: BorderSide(color: Color(0x14FFFFFF)))),
      child: Container(
        decoration: BoxDecoration(
            color: kPanel,
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: const Color(0x22FFFFFF))),
        padding: const EdgeInsets.only(left: 18, right: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Expanded(
            child: TextField(
              controller: widget.controller,
              focusNode: widget.focusNode,
              minLines: 1,
              maxLines: 5,
              maxLength: 1000,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => widget.onSend(null),
              style: const TextStyle(fontSize: 15),
              decoration: const InputDecoration(
                  hintText: 'Ask NEXO AI…',
                  hintStyle: TextStyle(color: kMuted),
                  border: InputBorder.none,
                  counterText: '',
                  contentPadding: EdgeInsets.symmetric(vertical: 14)),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 5),
            child: IconButton.filled(
              tooltip: 'Send',
              onPressed: canSend ? () => widget.onSend(null) : null,
              style: IconButton.styleFrom(
                  backgroundColor: kPink,
                  disabledBackgroundColor: const Color(0x33FFFFFF)),
              icon: widget.busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.arrow_upward_rounded, color: Colors.white),
            ),
          ),
        ]),
      ),
    );
  }
}
