import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme.dart';
import '../../domain/entities/catalog_item.dart';
import '../live/live_page.dart';
import '../shared/widgets.dart';
import 'catalog_cubit.dart';

class MovieDetailsPage extends StatefulWidget {
  const MovieDetailsPage({super.key, required this.slug});
  final String slug;
  @override
  State<MovieDetailsPage> createState() => _MovieDetailsPageState();
}

class _MovieDetailsPageState extends State<MovieDetailsPage> {
  late Future<CatalogItem?> _future =
      context.read<CatalogCubit>().loadMovieDetails(widget.slug);

  @override
  Widget build(BuildContext context) => _DetailScaffold(
        child: FutureBuilder<CatalogItem?>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(
                  child: CircularProgressIndicator(color: kPink));
            }
            final item = snapshot.data;
            if (item == null) {
              return _Unavailable(
                  title: 'Movie unavailable',
                  failed: snapshot.hasError,
                  retry: () => setState(() => _future = context
                      .read<CatalogCubit>()
                      .loadMovieDetails(widget.slug)));
            }
            return _DetailBody(item: item);
          },
        ),
      );
}

class SeriesDetailsPage extends StatefulWidget {
  const SeriesDetailsPage({super.key, required this.slug});
  final String slug;
  @override
  State<SeriesDetailsPage> createState() => _SeriesDetailsPageState();
}

class _SeriesDetailsPageState extends State<SeriesDetailsPage> {
  late Future<({CatalogItem? series, List<CatalogSeason> seasons})> _future =
      context.read<CatalogCubit>().loadSeriesPage(widget.slug);

  @override
  Widget build(BuildContext context) => _DetailScaffold(
        child:
            FutureBuilder<({CatalogItem? series, List<CatalogSeason> seasons})>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(
                  child: CircularProgressIndicator(color: kPink));
            }
            final series = snapshot.data?.series;
            if (series == null) {
              return _Unavailable(
                  title: 'Series unavailable',
                  failed: snapshot.hasError,
                  retry: () => setState(() => _future = context
                      .read<CatalogCubit>()
                      .loadSeriesPage(widget.slug)));
            }
            return _DetailBody(item: series, seasons: snapshot.data!.seasons);
          },
        ),
      );
}

class _DetailScaffold extends StatelessWidget {
  const _DetailScaffold({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Scaffold(
        extendBodyBehindAppBar: true,
        appBar: AppBar(
            backgroundColor: Colors.transparent,
            elevation: 0,
            scrolledUnderElevation: 0,
            leading: const Padding(
                padding: EdgeInsets.all(8),
                child: CircleAvatar(
                    backgroundColor: Colors.black45,
                    child: BackButton(color: Colors.white)))),
        body: child,
      );
}

class _Unavailable extends StatelessWidget {
  const _Unavailable(
      {required this.title, required this.failed, required this.retry});
  final String title;
  final bool failed;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => EmptyState(
      icon: Icons.movie_outlined,
      title: failed ? 'Could not load' : title,
      body: failed
          ? 'Check your connection and try again.'
          : 'This title is no longer in the catalog.',
      action: failed
          ? TextButton(onPressed: retry, child: const Text('Retry'))
          : null);
}

class _DetailBody extends StatefulWidget {
  const _DetailBody({required this.item, this.seasons = const []});
  final CatalogItem item;
  final List<CatalogSeason> seasons;
  @override
  State<_DetailBody> createState() => _DetailBodyState();
}

class _DetailBodyState extends State<_DetailBody> {
  int _season = 0;
  late final Future<FreeWatchOptions?> _freeWatchOptions =
      _loadFreeWatchOptions();

  Future<FreeWatchOptions?> _loadFreeWatchOptions() {
    final request = tmdbPlaybackRequest(widget.item.id);
    if (request == null || request.type != 'movie') return Future.value(null);
    final region =
        WidgetsBinding.instance.platformDispatcher.locale.countryCode;
    return context.read<CatalogCubit>().freeWatchOptions(
        type: 'movie',
        slug: widget.item.slug,
        region: region != null && RegExp(r'^[A-Za-z]{2}$').hasMatch(region)
            ? region.toUpperCase()
            : 'BD');
  }

  CatalogItem _episodeItem(CatalogSeason season, CatalogEpisode episode) =>
      CatalogItem(
        id: episode.id,
        slug: episode.id,
        name:
            '${widget.item.name} · S${season.number} E${episode.number} · ${episode.title}',
        category: widget.item.name,
        type: 'episode',
        synopsis: episode.synopsis,
        durationMinutes: episode.durationMinutes,
        backdropUrl: episode.stillUrl,
        playbackUrl: episode.playbackUrl,
        playbackKind: episode.playbackKind,
        trailerUrl: widget.item.trailerUrl,
      );

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final seasons = widget.seasons;
    final isSeries = item.type == 'series';
    final saved = context.watch<CatalogCubit>().state.isSaved(item);
    final season = seasons.isEmpty ? null : seasons[_season];
    final firstEpisode = season == null || season.episodes.isEmpty
        ? null
        : season.episodes.first;
    final metadata = [
      if (item.genres.isNotEmpty) item.genres.take(2).join(', '),
      if (item.year != null) '${item.year}',
      if (item.durationMinutes != null) '${item.durationMinutes} min',
      if (isSeries && seasons.isNotEmpty)
        '${seasons.length} season${seasons.length == 1 ? '' : 's'}',
      if (item.rating != null && item.rating! > 0) '★ ${item.rating}',
    ].join('  •  ');

    final media = MediaQuery.of(context);
    final size = media.size;
    // Tablets, desktop and landscape phones get the poster beside the details.
    final wide = size.width >= 720 || size.width > size.height * 1.2;
    final gutter = (size.width < 600 ? 18.0 : 32.0);
    final insets = EdgeInsets.only(
        left: gutter + media.padding.left, right: gutter + media.padding.right);

    final actions = <Widget>[
      PinkButton(
          label: isSeries && firstEpisode != null
              ? 'Watch S${season!.number} E${firstEpisode.number}'
              : 'Watch Now',
          icon: Icons.play_circle_fill,
          onPressed: isSeries
              ? (firstEpisode == null
                  ? null
                  : () =>
                      playItem(context, _episodeItem(season!, firstEpisode)))
              : () => playItem(context, item)),
      if (item.trailerUrl != null)
        _OutlineAction(
            icon: Icons.smart_display_outlined,
            label: 'Watch Trailer',
            onPressed: () => playItem(
                context,
                CatalogItem(
                    id: '${item.id}-trailer',
                    slug: '${item.slug}-trailer',
                    name: '${item.name} · Trailer',
                    category: 'Trailer',
                    type: 'video',
                    playbackUrl: item.trailerUrl,
                    playbackKind: 'youtube'))),
      _OutlineAction(
          icon: saved ? Icons.check : Icons.add,
          label: saved ? 'In My List' : 'Add to My List',
          onPressed: () => context.read<CatalogCubit>().toggle(item)),
    ];

    final details = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(item.name,
              style: TextStyle(
                  fontSize: wide ? 34 : 27,
                  height: 1.15,
                  fontWeight: FontWeight.w800)),
          if (metadata.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(metadata,
                style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 14,
                    fontWeight: FontWeight.w600)),
          ],
          const SizedBox(height: 18),
          // Full width stacked buttons on phones, a row of buttons when wide.
          if (wide)
            Wrap(spacing: 10, runSpacing: 10, children: [
              for (final action in actions)
                ConstrainedBox(
                    constraints:
                        const BoxConstraints(minWidth: 180, maxWidth: 260),
                    child: action),
            ])
          else
            for (var index = 0; index < actions.length; index++) ...[
              if (index > 0) const SizedBox(height: 10),
              actions[index],
            ],
          const SizedBox(height: 20),
          _Synopsis(
              text: item.synopsis.isEmpty
                  ? 'No description is available for this title yet.'
                  : item.synopsis),
          if (!isSeries && tmdbPlaybackRequest(item.id)?.type == 'movie') ...[
            const SizedBox(height: 22),
            _FreeWatchOptionsPanel(future: _freeWatchOptions),
          ],
        ]);

    final header = wide
        ? _WideHeader(item: item, insets: insets, details: details)
        : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _PhoneHero(item: item),
            Padding(padding: insets, child: details),
          ]);

    return ListView(
        // Room for the gesture or navigation bar below the last row.
        padding: EdgeInsets.only(bottom: media.padding.bottom + 28),
        children: [
          header,
          _Constrained(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (isSeries) ...[
                Padding(
                    padding: insets.copyWith(top: 30, bottom: 12),
                    child: const Text('Episodes',
                        style: TextStyle(
                            fontSize: 20, fontWeight: FontWeight.w700))),
                if (seasons.isEmpty)
                  Padding(
                      padding: insets,
                      child: const Text('Episodes have not been added yet.',
                          style: TextStyle(color: kMuted)))
                else ...[
                  if (seasons.length > 1)
                    FilterChips(
                        labels: [
                          for (final value in seasons) 'Season ${value.number}'
                        ],
                        selected: 'Season ${season!.number}',
                        onSelected: (label) => setState(() => _season = seasons
                            .indexWhere(
                                (value) => 'Season ${value.number}' == label)
                            .clamp(0, seasons.length - 1))),
                  const SizedBox(height: 8),
                  for (final episode in season!.episodes)
                    _EpisodeTile(
                        episode: episode,
                        insets: insets,
                        onTap: () =>
                            playItem(context, _episodeItem(season, episode))),
                ],
              ],
              Padding(
                  padding: EdgeInsets.only(
                      left: media.padding.left, right: media.padding.right),
                  child: const RightsNote()),
            ]),
          ),
        ]);
  }
}

/// Keeps content at a readable width on tablets and desktop.
class _Constrained extends StatelessWidget {
  const _Constrained({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1100), child: child));
}

/// Phones in portrait: the poster fills the top, fading into the page.
class _PhoneHero extends StatelessWidget {
  const _PhoneHero({required this.item});
  final CatalogItem item;
  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    // Never taller than the poster's own 2:3 shape at this width.
    final height =
        math.min(math.min(size.height * .6, size.width * 1.5), 560.0);
    return SizedBox(
      height: height,
      child: Stack(fit: StackFit.expand, children: [
        Artwork(
            url: item.posterUrl ?? item.backdropUrl,
            label: item.name,
            cacheWidth: 900,
            alignment: Alignment.topCenter),
        const DecoratedBox(
            decoration: BoxDecoration(
                gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    stops: [
              0,
              .2,
              .6,
              1
            ],
                    colors: [
              Color(0x99000000),
              Color(0x00000000),
              Color(0x33111114),
              kBg
            ]))),
      ]),
    );
  }
}

/// Tablets, desktop and landscape: a faded backdrop with the poster card
/// beside the title, buttons and description.
class _WideHeader extends StatelessWidget {
  const _WideHeader(
      {required this.item, required this.insets, required this.details});
  final CatalogItem item;
  final EdgeInsets insets;
  final Widget details;
  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final posterWidth = (media.size.width * .26).clamp(160.0, 300.0);
    return Stack(children: [
      Positioned.fill(
        child: Stack(fit: StackFit.expand, children: [
          Artwork(
              url: item.backdropUrl ?? item.posterUrl,
              label: item.name,
              cacheWidth: 1280,
              alignment: Alignment.topCenter),
          const DecoratedBox(
              decoration: BoxDecoration(
                  gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Color(0xCC111114), Color(0xE6111114), kBg]))),
        ]),
      ),
      _Constrained(
        child: Padding(
          padding: insets.copyWith(
              top: media.padding.top + kToolbarHeight + 12, bottom: 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: SizedBox(
                    width: posterWidth,
                    height: posterWidth * 1.5,
                    child: Artwork(
                        url: item.posterUrl ?? item.backdropUrl,
                        label: item.name,
                        cacheWidth: 600))),
            SizedBox(width: insets.left.clamp(20.0, 40.0)),
            Expanded(child: details),
          ]),
        ),
      ),
    ]);
  }
}

/// A full width outlined button that grows with the system text size.
class _OutlineAction extends StatelessWidget {
  const _OutlineAction(
      {required this.icon, required this.label, required this.onPressed});
  final IconData icon;
  final String label;
  final VoidCallback onPressed;
  @override
  Widget build(BuildContext context) => SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
            onPressed: onPressed,
            style: OutlinedButton.styleFrom(
                foregroundColor: Colors.white,
                minimumSize: const Size.fromHeight(48),
                padding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                side: const BorderSide(color: Color(0x55FFFFFF)),
                shape: const StadiumBorder()),
            icon: Icon(icon),
            label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis)),
      );
}

/// The description, cut to a few lines with More / Less when it is long.
class _Synopsis extends StatefulWidget {
  const _Synopsis({required this.text});
  final String text;
  @override
  State<_Synopsis> createState() => _SynopsisState();
}

class _SynopsisState extends State<_Synopsis> {
  static const _lines = 5;
  static const _style =
      TextStyle(height: 1.55, fontSize: 15, color: Colors.white70);
  bool _expanded = false;

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final painter = TextPainter(
            text: TextSpan(text: widget.text, style: _style),
            maxLines: _lines,
            textDirection: Directionality.of(context),
            textScaler: MediaQuery.textScalerOf(context))
          ..layout(maxWidth: box.maxWidth);
        final long = painter.didExceedMaxLines;
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          ConstrainedBox(
              // Readable line length on wide screens.
              constraints: const BoxConstraints(maxWidth: 760),
              child: Text(widget.text,
                  style: _style,
                  maxLines: _expanded || !long ? null : _lines,
                  overflow: _expanded || !long
                      ? TextOverflow.visible
                      : TextOverflow.ellipsis)),
          if (long)
            TextButton(
                onPressed: () => setState(() => _expanded = !_expanded),
                style: TextButton.styleFrom(
                    padding: EdgeInsets.zero,
                    minimumSize: const Size(0, 36),
                    foregroundColor: kPink),
                child: Text(_expanded ? 'Less' : 'More',
                    style: const TextStyle(fontWeight: FontWeight.w700))),
        ]);
      });
}

class _FreeWatchOptionsPanel extends StatelessWidget {
  const _FreeWatchOptionsPanel({required this.future});
  final Future<FreeWatchOptions?> future;

  Future<void> _open(String? value) async {
    if (value == null) return;
    final uri = Uri.tryParse(value);
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host != 'www.themoviedb.org') {
      return;
    }
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<FreeWatchOptions?>(
        future: future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done ||
              !snapshot.hasData) {
            return const SizedBox.shrink();
          }
          final options = snapshot.data!;
          if (options.region.isEmpty) return const SizedBox.shrink();
          return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Watch free in ${options.region}',
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                if (options.providers.isEmpty)
                  Text(
                      'No free or ad-supported options were found in ${options.region}.',
                      style: const TextStyle(color: Colors.white70))
                else ...[
                  Text('Free and ad-supported services',
                      style: const TextStyle(color: Colors.white70)),
                  const SizedBox(height: 10),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    for (final provider in options.providers)
                      Chip(
                        avatar: provider.logoUrl == null
                            ? const Icon(Icons.play_circle_outline, size: 18)
                            : ClipRRect(
                                borderRadius: BorderRadius.circular(4),
                                child: SizedBox.square(
                                    dimension: 22,
                                    child: Artwork(
                                        url: provider.logoUrl,
                                        label: provider.name,
                                        cacheWidth: 72))),
                        label: Text(
                            '${provider.name}${provider.kind == 'ads' ? ' · Ads' : ''}'),
                        backgroundColor: kPanel,
                        side: BorderSide.none,
                      ),
                  ]),
                  if (options.link != null) ...[
                    const SizedBox(height: 8),
                    TextButton.icon(
                      onPressed: () => _open(options.link),
                      icon: const Icon(Icons.open_in_new),
                      label: const Text('View availability on TMDB'),
                      style: TextButton.styleFrom(padding: EdgeInsets.zero),
                    ),
                  ],
                ],
              ]);
        },
      );
}

class _EpisodeTile extends StatelessWidget {
  const _EpisodeTile(
      {required this.episode, required this.insets, required this.onTap});
  final CatalogEpisode episode;
  final EdgeInsets insets;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: insets.copyWith(top: 9, bottom: 9),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: SizedBox(
                    width: railWidth(context, .34, min: 112, max: 220),
                    height:
                        railWidth(context, .34, min: 112, max: 220) * 9 / 16,
                    child: Stack(fit: StackFit.expand, children: [
                      Artwork(
                          url: episode.stillUrl,
                          label: 'E${episode.number}',
                          cacheWidth: 300),
                      const Center(
                          child: CircleAvatar(
                              radius: 16,
                              backgroundColor: Colors.black54,
                              child: Icon(Icons.play_arrow,
                                  size: 20, color: Colors.white))),
                    ]))),
            const SizedBox(width: 14),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text('${episode.number}. ${episode.title}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w600)),
                  if (episode.durationMinutes != null) ...[
                    const SizedBox(height: 3),
                    Text('${episode.durationMinutes} min',
                        style: const TextStyle(fontSize: 12, color: kMuted)),
                  ],
                  if (episode.synopsis.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(episode.synopsis,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 12, height: 1.35, color: kMuted)),
                  ],
                ])),
          ]),
        ),
      );
}
