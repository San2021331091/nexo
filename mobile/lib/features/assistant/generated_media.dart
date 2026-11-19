import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme.dart';
import '../../domain/entities/assistant.dart';
import '../../domain/entities/catalog_item.dart';
import '../catalog/catalog_cubit.dart';
import '../shared/widgets.dart';

/// The picture for a generated image, from its link or inline bytes.
Widget _picture(GeneratedImage image, {BoxFit fit = BoxFit.cover}) {
  if (image.inline) {
    final comma = image.url.indexOf(',');
    try {
      return Image.memory(base64Decode(image.url.substring(comma + 1)),
          fit: fit, gaplessPlayback: true);
    } catch (_) {
      return const _Broken();
    }
  }
  return Image.network(image.url,
      fit: fit,
      loadingBuilder: (context, child, progress) => progress == null
          ? child
          : const Center(
              child: SizedBox(
                  width: 28,
                  height: 28,
                  child: CircularProgressIndicator(
                      strokeWidth: 2.5, color: kPink))),
      errorBuilder: (_, __, ___) => const _Broken());
}

class _Broken extends StatelessWidget {
  const _Broken();
  @override
  Widget build(BuildContext context) => const ColoredBox(
      color: kPanel,
      child: Center(
          child: Icon(Icons.broken_image_outlined, color: kMuted, size: 32)));
}

/// Images NEXO AI made for an answer. Tap one to view it full screen.
class GeneratedImages extends StatelessWidget {
  const GeneratedImages({super.key, required this.images});
  final List<GeneratedImage> images;

  void _view(BuildContext context, GeneratedImage image) =>
      Navigator.of(context).push(MaterialPageRoute<void>(
          fullscreenDialog: true, builder: (_) => _ImageViewer(image: image)));

  @override
  Widget build(BuildContext context) {
    final maxWidth = MediaQuery.sizeOf(context).width - 70;
    return Wrap(spacing: 10, runSpacing: 10, children: [
      for (final image in images)
        Semantics(
          button: true,
          label: 'Generated image',
          child: GestureDetector(
            onTap: () => _view(context, image),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(
                width: (image.shape == 'wide' ? 340.0 : 230.0)
                    .clamp(120.0, maxWidth),
                child: AspectRatio(
                    aspectRatio: image.aspectRatio,
                    child: Stack(fit: StackFit.expand, children: [
                      _picture(image),
                      const Positioned(
                          right: 8,
                          bottom: 8,
                          child: CircleAvatar(
                              radius: 15,
                              backgroundColor: Colors.black54,
                              child: Icon(Icons.open_in_full,
                                  size: 16, color: Colors.white))),
                    ])),
              ),
            ),
          ),
        ),
    ]);
  }
}

class _ImageViewer extends StatelessWidget {
  const _ImageViewer({required this.image});
  final GeneratedImage image;
  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.black,
          title: const Text('Generated image'),
          actions: [
            if (!image.inline)
              IconButton(
                  tooltip: 'Open in browser to save or share',
                  onPressed: () => launchUrl(Uri.parse(image.url),
                      mode: LaunchMode.externalApplication),
                  icon: const Icon(Icons.open_in_new)),
          ],
        ),
        body: Center(
            child: InteractiveViewer(
                maxScale: 5,
                child: AspectRatio(
                    aspectRatio: image.aspectRatio,
                    child: _picture(image, fit: BoxFit.contain)))),
      );
}

/// A video NEXO AI is making: shows progress, then plays in the app.
class GeneratedVideoCard extends StatefulWidget {
  const GeneratedVideoCard({super.key, required this.id});
  final String id;
  @override
  State<GeneratedVideoCard> createState() => _GeneratedVideoCardState();
}

class _GeneratedVideoCardState extends State<GeneratedVideoCard> {
  // Finished videos, so reopening a chat does not ask again.
  static final _finished = <String, GeneratedVideo>{};
  static const _interval = Duration(seconds: 6);
  static const _giveUpAfter = Duration(minutes: 20);

  late GeneratedVideo _video =
      _finished[widget.id] ?? GeneratedVideo(id: widget.id);
  Timer? _timer;
  final _started = DateTime.now();

  @override
  void initState() {
    super.initState();
    if (!_video.finished) _check();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _check() async {
    try {
      final video = await context
          .read<CatalogCubit>()
          .repository
          .generatedVideo(widget.id);
      if (!mounted) return;
      setState(() => _video = video);
      if (video.finished) {
        _finished[widget.id] = video;
        return;
      }
    } catch (_) {
      // A failed check is retried; the video itself may be fine.
    }
    if (!mounted) return;
    if (DateTime.now().difference(_started) > _giveUpAfter) {
      setState(() => _video = GeneratedVideo(id: widget.id, status: 'failed'));
      return;
    }
    _timer = Timer(_interval, _check);
  }

  void _play() => playItem(
      context,
      CatalogItem(
          id: 'ai-${widget.id}',
          slug: 'ai-${widget.id}',
          name: 'NEXO AI video',
          category: 'Made with NEXO AI',
          type: 'video',
          playbackUrl: _video.url,
          playbackKind: 'video'));

  @override
  Widget build(BuildContext context) {
    final video = _video;
    final width = (MediaQuery.sizeOf(context).width - 70).clamp(160.0, 340.0);
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        width: width,
        child: AspectRatio(
          aspectRatio: 16 / 9,
          child: Material(
            color: kPanel,
            child: InkWell(
              onTap: video.status == 'done' ? _play : null,
              child: Stack(fit: StackFit.expand, children: [
                const DecoratedBox(
                    decoration: BoxDecoration(
                        gradient: LinearGradient(
                            colors: [Color(0x55FF2E86), Color(0x447B5CFF)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight))),
                Center(
                  child: switch (video.status) {
                    'done' => const CircleAvatar(
                        radius: 28,
                        backgroundColor: kPink,
                        child: Icon(Icons.play_arrow_rounded,
                            size: 34, color: Colors.white)),
                    'failed' =>
                      const Column(mainAxisSize: MainAxisSize.min, children: [
                        Icon(Icons.error_outline,
                            color: Color(0xFFFF8A9B), size: 30),
                        SizedBox(height: 8),
                        Text('The video could not be made.',
                            style: TextStyle(fontSize: 13)),
                      ]),
                    _ => Column(mainAxisSize: MainAxisSize.min, children: [
                        SizedBox(
                          width: 34,
                          height: 34,
                          child: CircularProgressIndicator(
                              strokeWidth: 3,
                              color: kPink,
                              value: video.progress > 0
                                  ? video.progress / 100
                                  : null),
                        ),
                        const SizedBox(height: 10),
                        Text(
                            video.status == 'queued'
                                ? 'Waiting to start…'
                                : video.progress > 0
                                    ? 'Making your video… ${video.progress}%'
                                    : 'Making your video…',
                            style: const TextStyle(fontSize: 13)),
                        const SizedBox(height: 2),
                        const Text('Usually a few minutes',
                            style: TextStyle(fontSize: 11, color: kMuted)),
                      ]),
                  },
                ),
                const Positioned(
                    left: 10,
                    top: 8,
                    child: Row(children: [
                      Icon(Icons.auto_awesome, size: 14, color: Colors.white70),
                      SizedBox(width: 5),
                      Text('AI video',
                          style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: Colors.white70)),
                    ])),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
