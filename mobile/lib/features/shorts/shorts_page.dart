import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:youtube_player_iframe/youtube_player_iframe.dart';

import '../../core/theme.dart';
import '../../domain/entities/catalog_item.dart';
import '../player/player_page.dart';
import '../shared/widgets.dart';

/// What the Shorts viewer opens with: the rail's items and the tapped one.
class ShortsArgs {
  const ShortsArgs({required this.items, this.index = 0});
  final List<CatalogItem> items;
  final int index;
}

/// Full screen vertical Shorts, swiped up and down like Reels. Only the
/// visible page holds a player; neighbours show their thumbnail.
class ShortsPage extends StatefulWidget {
  const ShortsPage({super.key, required this.args});
  final ShortsArgs args;
  @override
  State<ShortsPage> createState() => _ShortsPageState();
}

class _ShortsPageState extends State<ShortsPage> {
  late final PageController _pages =
      PageController(initialPage: widget.args.index);
  late int _current = widget.args.index;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.args.items;
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(children: [
        PageView.builder(
          controller: _pages,
          scrollDirection: Axis.vertical,
          itemCount: items.length,
          onPageChanged: (index) => setState(() => _current = index),
          itemBuilder: (context, index) =>
              _ShortView(item: items[index], active: index == _current),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Row(children: [
              const CircleAvatar(
                  backgroundColor: Colors.black45,
                  child: BackButton(color: Colors.white)),
              const Spacer(),
              if (items.isNotEmpty)
                IconButton.filledTonal(
                    tooltip: 'Watch on YouTube',
                    style:
                        IconButton.styleFrom(backgroundColor: Colors.black45),
                    onPressed: () => launchUrl(
                        Uri.parse(items[_current].playbackUrl ?? ''),
                        mode: LaunchMode.externalApplication),
                    icon: const Icon(Icons.open_in_new, color: Colors.white)),
            ]),
          ),
        ),
      ]),
    );
  }
}

class _ShortView extends StatelessWidget {
  const _ShortView({required this.item, required this.active});
  final CatalogItem item;
  final bool active;

  @override
  @override
  // The player is a native view that paints over Flutter widgets, so the
  // caption gets its own space below the video instead of overlapping it.
  Widget build(BuildContext context) => SafeArea(
        child: Column(children: [
          // Room for the back and "open in YouTube" buttons.
          const SizedBox(height: 56),
          Expanded(
            child: Center(
              child: AspectRatio(
                aspectRatio: 9 / 16,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: active
                      ? _ShortPlayer(key: ValueKey(item.id), item: item)
                      : Artwork(
                          url: item.posterUrl ?? item.wideImage,
                          label: item.name,
                          cacheWidth: 720),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(item.category,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: kPink,
                            fontSize: 13,
                            fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Text(item.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 15,
                            height: 1.3,
                            fontWeight: FontWeight.w600)),
                  ]),
            ),
          ),
        ]),
      );
}

class _ShortPlayer extends StatefulWidget {
  const _ShortPlayer({super.key, required this.item});
  final CatalogItem item;
  @override
  State<_ShortPlayer> createState() => _ShortPlayerState();
}

class _ShortPlayerState extends State<_ShortPlayer> {
  YoutubePlayerController? _controller;

  @override
  void initState() {
    super.initState();
    final uri = Uri.tryParse(widget.item.playbackUrl ?? '');
    final id = uri == null ? null : youtubeVideoId(uri);
    if (id != null) {
      _controller = YoutubePlayerController.fromVideoId(
          videoId: id,
          autoPlay: true,
          params: const YoutubePlayerParams(
              showControls: true,
              showFullscreenButton: false,
              strictRelatedVideos: true,
              loop: true,
              origin: youtubeOrigin));
    }
  }

  @override
  void dispose() {
    _controller?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _controller == null
      ? const Center(
          child: Text('This short cannot be played.',
              style: TextStyle(color: Colors.white70)))
      : YoutubePlayer(
          controller: _controller!,
          aspectRatio: 9 / 16,
          // The player otherwise claims vertical swipes to toggle full screen,
          // which stops the viewer swiping to the next short.
          enableFullScreenOnVerticalDrag: false);
}
