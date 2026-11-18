import 'dart:convert';
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../domain/entities/catalog_item.dart';
import '../shorts/shorts_page.dart';

/// Opens the right screen for an item: details for titles, the player otherwise.
void openItem(BuildContext context, CatalogItem item) {
  if (item.type == 'movie') {
    context.push('/movie/${Uri.encodeComponent(item.slug)}');
  } else if (item.type == 'series') {
    context.push('/series/${Uri.encodeComponent(item.slug)}');
  } else if (item.type == 'short') {
    context.push('/shorts', extra: ShortsArgs(items: [item]));
  } else {
    playItem(context, item);
  }
}

String playerLocation(CatalogItem item) =>
    Uri(path: '/player/${Uri.encodeComponent(item.id)}', queryParameters: {
      'name': item.name,
      if (item.isPlayable) 'url': item.playbackUrl,
      'type': item.type,
      'playbackKind': item.playbackKind,
      'category': item.category,
      if (item.playbackServers.isNotEmpty)
        'servers': jsonEncode(item.playbackServers
            .map((server) => {
                  'label': server.label,
                  'provider': server.provider,
                  'url': server.url,
                })
            .toList()),
      if (item.trailerUrl != null) 'trailer': item.trailerUrl,
    }).toString();

/// Starts playback, or explains that the item has no source right now.
void playItem(BuildContext context, CatalogItem item) {
  if (!item.isPlayable) {
    showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
              title: const Text('Not available right now'),
              content: Text('${item.name} has no playback source yet.'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: const Text('OK'))
              ],
            ));
    return;
  }
  context.push(playerLocation(item));
}

/// Network artwork with a branded fallback showing the title.
class Artwork extends StatelessWidget {
  const Artwork(
      {super.key,
      required this.url,
      required this.label,
      this.fit = BoxFit.cover,
      this.cacheWidth = 400,
      this.alignment = Alignment.center,
      this.placeholder});
  final String? url;

  /// Shown instead of the default titled panel when there is no image.
  final Widget? placeholder;
  final String label;
  final BoxFit fit;
  final int cacheWidth;
  final Alignment alignment;

  Widget _fallback() =>
      placeholder ??
      DecoratedBox(
        decoration: const BoxDecoration(
            gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF3B2341), kPanel])),
        child: Center(
            child: Padding(
                padding: const EdgeInsets.all(10),
                child: Text(label,
                    textAlign: TextAlign.center,
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, color: Colors.white70)))),
      );

  static const _wikimediaHost = 'upload.wikimedia.org';
  // Wikimedia asks clients to identify themselves and throttles generic ones.
  static const _wikimediaHeaders = {'User-Agent': 'NexoApp/1.0 (Flutter)'};
  // Matches an SVG file or one of its rendered thumbnails, e.g.
  // /wikipedia/commons/c/cf/Logo.svg or /wikipedia/en/thumb/c/cf/Logo.svg/120px-Logo.svg.png
  static final _wikimediaSvg = RegExp(
      r'^https://upload\.wikimedia\.org/wikipedia/([^/]+)/(?:thumb/)?([0-9a-f]/[0-9a-f]{2})/([^/?#]+\.svg)(?:/[^?#]*)?(?:[?#].*)?$',
      caseSensitive: false);

  /// Most Wikipedia logos style their shapes with CSS, which flutter_svg does
  /// not apply, so they draw blank or black. Wikimedia renders SVGs to PNG on
  /// its CDN; use that rendering, keeping the SVG as a fallback. 250px is one
  /// of Wikimedia's standard widths — non-standard widths get refused.
  static ({String png, String svg})? _wikimediaRendering(String raw) {
    final match = _wikimediaSvg.firstMatch(raw);
    if (match == null) return null;
    final base = 'https://$_wikimediaHost/wikipedia/${match[1]}';
    final file = match[3]!;
    return (
      png: '$base/thumb/${match[2]}/$file/250px-$file.png',
      svg: '$base/${match[2]}/$file',
    );
  }

  Map<String, String>? _headersFor(String raw) =>
      Uri.tryParse(raw)?.host.toLowerCase() == _wikimediaHost
          ? _wikimediaHeaders
          : null;

  Widget _raster(String src, Widget Function() onError) => Image.network(src,
      headers: _headersFor(src),
      fit: fit,
      alignment: alignment,
      cacheWidth: cacheWidth,
      errorBuilder: (_, __, ___) => onError(),
      frameBuilder: (_, child, frame, loaded) =>
          loaded || frame != null ? child : const ColoredBox(color: kPanel));

  Widget _svg(String src) => SvgPicture.network(src,
      headers: _headersFor(src),
      fit: fit,
      alignment: alignment,
      placeholderBuilder: (_) => const ColoredBox(color: kPanel),
      errorBuilder: (_, __, ___) => _fallback());

  @override
  Widget build(BuildContext context) {
    final raw = url?.trim();
    if (raw == null || raw.isEmpty) return _fallback();
    final wikimedia = _wikimediaRendering(raw);
    if (wikimedia != null) {
      return _raster(wikimedia.png, () => _svg(wikimedia.svg));
    }
    final isSvg =
        Uri.tryParse(raw)?.path.toLowerCase().endsWith('.svg') ?? false;
    return isSvg ? _svg(raw) : _raster(raw, _fallback);
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.onViewAll});
  final String title;
  final VoidCallback? onViewAll;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 30, 6, 12),
        child: Row(children: [
          Expanded(
              child: Text(title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 19, fontWeight: FontWeight.w600))),
          if (onViewAll != null)
            TextButton(
                onPressed: onViewAll,
                style: TextButton.styleFrom(foregroundColor: Colors.white),
                child: const Row(mainAxisSize: MainAxisSize.min, children: [
                  Text('View All',
                      style:
                          TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                  SizedBox(width: 4),
                  Icon(Icons.chevron_right, color: kPink, size: 24),
                ]))
          else
            const SizedBox(height: 48),
        ]),
      );
}

/// Height of [lines] of text at [fontSize], following the system font size.
double textBlockHeight(BuildContext context, double fontSize,
        {int lines = 1, double lineHeight = 1.35}) =>
    MediaQuery.textScalerOf(context).scale(fontSize) * lineHeight * lines;

/// A rail card width that follows the screen: [fraction] of the width,
/// kept between [min] and [max].
double railWidth(BuildContext context, double fraction,
        {required double min, required double max}) =>
    (MediaQuery.sizeOf(context).width * fraction).clamp(min, max);

/// A white circular channel badge, as on the live rails.
class ChannelCircle extends StatelessWidget {
  const ChannelCircle({super.key, required this.item, this.size = 100});
  final CatalogItem item;
  final double size;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: size,
        child: InkWell(
          onTap: () => openItem(context, item),
          borderRadius: BorderRadius.circular(12),
          child: Column(children: [
            Container(
                height: size,
                width: size,
                clipBehavior: Clip.antiAlias,
                decoration: const BoxDecoration(
                    shape: BoxShape.circle, color: Colors.white),
                padding: EdgeInsets.all(size * .14),
                child: Artwork(
                    url: item.logoUrl,
                    label: item.name,
                    fit: BoxFit.contain,
                    cacheWidth: (size * 3).round(),
                    placeholder: Center(
                        child: Text(
                            item.name.isEmpty
                                ? '?'
                                : item.name.characters.first.toUpperCase(),
                            style: TextStyle(
                                fontSize: size * .34,
                                fontWeight: FontWeight.w800,
                                color: kBg))))),
            const SizedBox(height: 7),
            Text(item.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11, color: kMuted)),
          ]),
        ),
      );
}

class CircleRail extends StatelessWidget {
  const CircleRail({super.key, required this.items});
  final List<CatalogItem> items;
  @override
  Widget build(BuildContext context) {
    final size = railWidth(context, .25, min: 84, max: 120);
    return SizedBox(
      height: size + 7 + textBlockHeight(context, 11) + 2,
      child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: items.length,
          itemBuilder: (context, index) =>
              ChannelCircle(item: items[index], size: size),
          separatorBuilder: (_, __) => const SizedBox(width: 14)),
    );
  }
}

/// A 2:3 poster. Fills its parent, so wrap it in a sized box or a grid cell.
class PosterCard extends StatelessWidget {
  const PosterCard({super.key, required this.item});
  final CatalogItem item;
  @override
  Widget build(BuildContext context) => Semantics(
        button: true,
        label: item.name,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: Material(
            color: kPanel,
            child: InkWell(
                onTap: () => openItem(context, item),
                child: Ink(
                    child: Artwork(
                        url: item.posterUrl ?? item.backdropUrl,
                        label: item.name))),
          ),
        ),
      );
}

class PosterRail extends StatelessWidget {
  const PosterRail({super.key, required this.items});
  final List<CatalogItem> items;
  @override
  Widget build(BuildContext context) {
    final width = railWidth(context, .38, min: 120, max: 190);
    return SizedBox(
        height: width * 1.5,
        child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: items.length,
            itemBuilder: (context, index) =>
                SizedBox(width: width, child: PosterCard(item: items[index])),
            separatorBuilder: (_, __) => const SizedBox(width: 8)));
  }
}

/// Posters with a large outlined rank number, as in "Top Ten".
class RankedRail extends StatelessWidget {
  const RankedRail({super.key, required this.items});
  final List<CatalogItem> items;
  @override
  Widget build(BuildContext context) => SizedBox(
      height: 186,
      child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: items.length,
          itemBuilder: (context, index) => SizedBox(
              width: 124,
              child: Stack(fit: StackFit.expand, children: [
                PosterCard(item: items[index]),
                Positioned(
                    right: 2,
                    bottom: -14,
                    child: IgnorePointer(
                        child: Text('${index + 1}',
                            style: TextStyle(
                                fontSize: 92,
                                height: 1,
                                fontWeight: FontWeight.w900,
                                foreground: Paint()
                                  ..style = PaintingStyle.stroke
                                  ..strokeWidth = 3
                                  ..color = Colors.white)))),
              ])),
          separatorBuilder: (_, __) => const SizedBox(width: 8)));
}

/// 16:9 cards with a caption, used for sports videos.
class LandscapeRail extends StatelessWidget {
  const LandscapeRail({super.key, required this.items});
  final List<CatalogItem> items;
  @override
  Widget build(BuildContext context) {
    final width = railWidth(context, .66, min: 220, max: 340);
    final imageHeight = width * 9 / 16;
    return SizedBox(
      height: imageHeight +
          8 +
          textBlockHeight(context, 13, lines: 2, lineHeight: 1.25) +
          4,
      child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: items.length,
          itemBuilder: (context, index) {
            final item = items[index];
            return SizedBox(
                width: width,
                child: InkWell(
                  onTap: () => openItem(context, item),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: SizedBox(
                                height: imageHeight,
                                width: width,
                                child: Stack(fit: StackFit.expand, children: [
                                  Artwork(
                                      url: item.wideImage,
                                      label: item.name,
                                      cacheWidth: 520),
                                  const Center(
                                      child: CircleAvatar(
                                          radius: 20,
                                          backgroundColor: Colors.black54,
                                          child: Icon(Icons.play_arrow,
                                              color: Colors.white))),
                                ]))),
                        const SizedBox(height: 8),
                        Text(item.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 13,
                                height: 1.25,
                                fontWeight: FontWeight.w600)),
                      ]),
                ));
          },
          separatorBuilder: (_, __) => const SizedBox(width: 10)),
    );
  }
}

/// Vertical 9:16 cards for YouTube Shorts; tapping opens the swipe viewer.
class ShortsRail extends StatelessWidget {
  const ShortsRail({super.key, required this.items});
  final List<CatalogItem> items;
  @override
  Widget build(BuildContext context) {
    final width = railWidth(context, .34, min: 118, max: 180);
    return SizedBox(
      height: width * 16 / 9,
      child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: items.length,
          itemBuilder: (context, index) {
            final item = items[index];
            return InkWell(
              onTap: () => context.push('/shorts',
                  extra: ShortsArgs(items: items, index: index)),
              borderRadius: BorderRadius.circular(8),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: SizedBox(
                  width: width,
                  child: Stack(fit: StackFit.expand, children: [
                    Artwork(
                        url: item.posterUrl ?? item.wideImage,
                        label: item.name,
                        cacheWidth: 400),
                    const DecoratedBox(
                        decoration: BoxDecoration(
                            gradient: LinearGradient(
                                begin: Alignment.center,
                                end: Alignment.bottomCenter,
                                colors: [
                          Color(0x00000000),
                          Color(0xDD000000)
                        ]))),
                    Positioned(
                        left: 8,
                        right: 8,
                        bottom: 8,
                        child: Text(item.name,
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontSize: 12,
                                height: 1.25,
                                fontWeight: FontWeight.w700))),
                    const Positioned(
                        top: 6,
                        right: 6,
                        child: Icon(Icons.play_circle_outline,
                            color: Colors.white, size: 22)),
                  ]),
                ),
              ),
            );
          },
          separatorBuilder: (_, __) => const SizedBox(width: 10)),
    );
  }
}

/// A list row with a landscape thumbnail, as in Discover and My List.
class MediaRow extends StatelessWidget {
  const MediaRow({super.key, required this.item, this.trailing});
  final CatalogItem item;
  final Widget? trailing;

  String get _subtitle => switch (item.type) {
        'channel' => 'Live TV · ${item.category}',
        'video' => item.category,
        'series' =>
          ['Series', if (item.year != null) '${item.year}'].join(' · '),
        _ => [
            if (item.type == 'movie') 'Movie',
            if (item.year != null) '${item.year}'
          ].join(' · '),
      };

  Widget _thumbnail(double width) {
    final cacheWidth =
        (width * 3).round(); // enough pixels for high-density screens
    if (item.type == 'channel') {
      return ColoredBox(
          color: Colors.white,
          child: Padding(
              padding: EdgeInsets.all(width * .08),
              child: Artwork(
                  url: item.logoUrl,
                  label: item.name,
                  fit: BoxFit.contain,
                  cacheWidth: cacheWidth)));
    }
    // Landscape artwork fills the frame. A portrait poster would be cropped
    // to a thin strip, so show it whole over a blurred copy of itself.
    if (item.backdropUrl != null || item.posterUrl == null) {
      return Artwork(
          url: item.wideImage,
          label: item.name,
          cacheWidth: cacheWidth,
          alignment: Alignment.topCenter);
    }
    return Stack(fit: StackFit.expand, children: [
      ImageFiltered(
          imageFilter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
          child: Artwork(url: item.posterUrl, label: '', cacheWidth: 120)),
      const ColoredBox(color: Color(0x66000000)),
      Artwork(
          url: item.posterUrl,
          label: item.name,
          fit: BoxFit.contain,
          cacheWidth: cacheWidth),
    ]);
  }

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: () => openItem(context, item),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 9),
          child: LayoutBuilder(builder: (context, constraints) {
            // About a third of the row on phones, capped on tablets.
            final width = (constraints.maxWidth * .36).clamp(112.0, 220.0);
            return Row(children: [
              ClipRRect(
                  borderRadius: BorderRadius.circular(3),
                  child: SizedBox(
                      width: width,
                      height: width * 9 / 16,
                      child: _thumbnail(width))),
              const SizedBox(width: 16),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Text(item.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w600)),
                    if (_subtitle.isNotEmpty) ...[
                      const SizedBox(height: 5),
                      Text(_subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 13, color: kMuted)),
                    ],
                  ])),
              if (trailing != null) trailing!,
            ]);
          }),
        ),
      );
}

/// The wide pink call-to-action pill.
class PinkButton extends StatelessWidget {
  const PinkButton(
      {super.key, required this.label, required this.onPressed, this.icon});
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  @override
  Widget build(BuildContext context) => SizedBox(
        width: double.infinity,
        height: 50,
        child: FilledButton(
            onPressed: onPressed,
            style: FilledButton.styleFrom(
                backgroundColor: kPink,
                foregroundColor: Colors.white,
                shape: const StadiumBorder()),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              if (icon != null) ...[
                Icon(icon, size: 24),
                const SizedBox(width: 8)
              ],
              Flexible(
                  child: Text(label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w700))),
            ])),
      );
}

class EmptyState extends StatelessWidget {
  const EmptyState(
      {super.key,
      required this.icon,
      required this.title,
      required this.body,
      this.action});
  final IconData icon;
  final String title;
  final String body;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Center(
      child: Padding(
          padding: const EdgeInsets.all(30),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, color: Colors.white38, size: 64),
            const SizedBox(height: 18),
            Text(title,
                textAlign: TextAlign.center,
                style:
                    const TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            Text(body,
                textAlign: TextAlign.center,
                style: const TextStyle(color: kMuted, height: 1.5)),
            if (action != null) ...[const SizedBox(height: 22), action!],
          ])));
}

class ErrorNotice extends StatelessWidget {
  const ErrorNotice({super.key, required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.fromLTRB(14, 8, 6, 8),
      decoration: BoxDecoration(
          color: const Color(0xFF3B2331),
          borderRadius: BorderRadius.circular(14)),
      child: Row(children: [
        Expanded(child: Text(message)),
        TextButton(onPressed: retry, child: const Text('Retry'))
      ]));
}

class RightsNote extends StatelessWidget {
  const RightsNote({super.key});
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.fromLTRB(20, 28, 20, 4),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.info_outline, size: 15, color: kMuted),
        const SizedBox(width: 8),
        const Expanded(
            child: Text(
                'Availability depends on rights and the source provider.',
                style: TextStyle(color: kMuted, fontSize: 11, height: 1.4))),
      ]));
}
