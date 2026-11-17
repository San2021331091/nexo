import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

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
    final heroHeight = math.min(MediaQuery.sizeOf(context).height * .6, 560.0);

    return ListView(padding: EdgeInsets.zero, children: [
      SizedBox(
        height: heroHeight,
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
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(18, 0, 18, 0),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(item.name,
              style: const TextStyle(
                  fontSize: 27, height: 1.15, fontWeight: FontWeight.w800)),
          if (metadata.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(metadata,
                style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 14,
                    fontWeight: FontWeight.w600)),
          ],
          const SizedBox(height: 18),
          PinkButton(
              label: isSeries && firstEpisode != null
                  ? 'Watch S${season!.number} E${firstEpisode.number}'
                  : 'Watch Now',
              icon: Icons.play_circle_fill,
              onPressed: isSeries
                  ? (firstEpisode == null
                      ? null
                      : () => playItem(
                          context, _episodeItem(season!, firstEpisode)))
                  : () => playItem(context, item)),
          if (item.trailerUrl != null) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: OutlinedButton.icon(
                  onPressed: () => playItem(
                      context,
                      CatalogItem(
                          id: '${item.id}-trailer',
                          slug: '${item.slug}-trailer',
                          name: '${item.name} · Trailer',
                          category: 'Trailer',
                          type: 'video',
                          playbackUrl: item.trailerUrl,
                          playbackKind: 'youtube')),
                  style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: Color(0x55FFFFFF)),
                      shape: const StadiumBorder()),
                  icon: const Icon(Icons.smart_display_outlined),
                  label: const Text('Watch Trailer')),
            ),
          ],
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: OutlinedButton.icon(
                onPressed: () => context.read<CatalogCubit>().toggle(item),
                style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white,
                    side: const BorderSide(color: Color(0x55FFFFFF)),
                    shape: const StadiumBorder()),
                icon: Icon(saved ? Icons.check : Icons.add),
                label: Text(saved ? 'In My List' : 'Add to My List')),
          ),
          const SizedBox(height: 20),
          Text(
              item.synopsis.isEmpty
                  ? 'No description is available for this title yet.'
                  : item.synopsis,
              style: const TextStyle(
                  height: 1.55, fontSize: 15, color: Colors.white70)),
        ]),
      ),
      if (isSeries) ...[
        const Padding(
            padding: EdgeInsets.fromLTRB(18, 30, 18, 12),
            child: Text('Episodes',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700))),
        if (seasons.isEmpty)
          const Padding(
              padding: EdgeInsets.symmetric(horizontal: 18),
              child: Text('Episodes have not been added yet.',
                  style: TextStyle(color: kMuted)))
        else ...[
          if (seasons.length > 1)
            FilterChips(
                labels: [for (final value in seasons) 'Season ${value.number}'],
                selected: 'Season ${season!.number}',
                onSelected: (label) => setState(() => _season = seasons
                    .indexWhere((value) => 'Season ${value.number}' == label)
                    .clamp(0, seasons.length - 1))),
          const SizedBox(height: 8),
          for (final episode in season!.episodes)
            _EpisodeTile(
                episode: episode,
                onTap: () => playItem(context, _episodeItem(season, episode))),
        ],
      ],
      const RightsNote(),
      const SizedBox(height: 28),
    ]);
  }
}

class _EpisodeTile extends StatelessWidget {
  const _EpisodeTile({required this.episode, required this.onTap});
  final CatalogEpisode episode;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 9),
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
