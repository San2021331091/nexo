import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme.dart';
import '../../domain/entities/catalog_item.dart';
import '../catalog/catalog_cubit.dart';
import '../search/section_search_page.dart';
import '../shared/widgets.dart';

const _tabs = [
  (id: 'all', label: 'All'),
  (id: 'live', label: 'Live TV'),
  (id: 'sports', label: 'Sports'),
  (id: 'movies', label: 'Movies'),
  (id: 'series', label: 'Web Series'),
  (id: 'dramas', label: 'Dramas'),
];

const _logoRowHeight = 50.0;
const _tabRowHeight = 54.0;

/// Home: category tabs over a full-bleed hero and content rails.
class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int _tab = 0;
  final _scrolled = ValueNotifier<bool>(false);

  @override
  void dispose() {
    _scrolled.dispose();
    super.dispose();
  }

  void _select(int index) {
    if (index == _tab) return;
    _scrolled.value = false;
    setState(() => _tab = index);
  }

  @override
  Widget build(BuildContext context) {
    final tab = _tabs[_tab].id;
    return Stack(children: [
      Positioned.fill(
          child: _FeedView(
              key: ValueKey(tab),
              tab: tab,
              onScrolled: (value) => _scrolled.value = value)),
      Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: ValueListenableBuilder<bool>(
              valueListenable: _scrolled,
              builder: (context, scrolled, _) => _Header(
                  scrolled: scrolled, selected: _tab, onSelect: _select))),
    ]);
  }
}

class _Header extends StatelessWidget {
  const _Header(
      {required this.scrolled, required this.selected, required this.onSelect});
  final bool scrolled;
  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) => AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        decoration: BoxDecoration(
            color: scrolled ? const Color(0xF0111114) : null,
            gradient: scrolled
                ? null
                : const LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Color(0xB3000000), Color(0x00000000)])),
        child: SafeArea(
          bottom: false,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            AnimatedSize(
              duration: const Duration(milliseconds: 180),
              alignment: Alignment.topCenter,
              child: scrolled
                  ? const SizedBox(width: double.infinity)
                  : SizedBox(
                      height: _logoRowHeight,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Align(
                            alignment: Alignment.centerLeft,
                            child: Image.asset('assets/nexo-logo.png',
                                height: 36,
                                fit: BoxFit.contain,
                                errorBuilder: (_, __, ___) => const Text('NEXO',
                                    style: TextStyle(
                                        fontSize: 22,
                                        fontWeight: FontWeight.w900,
                                        letterSpacing: 2)))),
                      )),
            ),
            SizedBox(
              height: _tabRowHeight,
              child: Row(children: [
                Expanded(
                    child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  itemCount: _tabs.length,
                  itemBuilder: (context, index) {
                    final active = index == selected;
                    return InkWell(
                      onTap: () => onSelect(index),
                      borderRadius: BorderRadius.circular(8),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(_tabs[index].label,
                                  style: TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w600,
                                      color: active
                                          ? Colors.white
                                          : Colors.white
                                              .withValues(alpha: .78))),
                              const SizedBox(height: 6),
                              Container(
                                  height: 2,
                                  width: 34,
                                  color: active
                                      ? Colors.white
                                      : Colors.transparent),
                            ]),
                      ),
                    );
                  },
                )),
                // Searches only the open tab: Sports finds sports, Dramas dramas.
                IconButton(
                    tooltip: 'Search ${_tabs[selected].label}',
                    onPressed: () =>
                        context.push(Uri(path: '/search', queryParameters: {
                          if (sectionForTab[_tabs[selected].id] != null)
                            'section': sectionForTab[_tabs[selected].id]!
                        }).toString()),
                    icon: const Icon(Icons.search, size: 26)),
                const SizedBox(width: 6),
              ]),
            ),
          ]),
        ),
      );
}

class _FeedView extends StatefulWidget {
  const _FeedView({super.key, required this.tab, required this.onScrolled});
  final String tab;
  final ValueChanged<bool> onScrolled;
  @override
  State<_FeedView> createState() => _FeedViewState();
}

class _FeedViewState extends State<_FeedView> {
  final _controller = ScrollController();

  @override
  void initState() {
    super.initState();
    _controller.addListener(() => widget.onScrolled(_controller.offset > 36));
    context.read<CatalogCubit>().loadFeed(widget.tab);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Widget _rail(HomeSection section) => switch (section.style) {
        'circles' => CircleRail(items: section.items),
        'landscape' => LandscapeRail(items: section.items),
        'ranked' => RankedRail(items: section.items),
        'shorts' => ShortsRail(items: section.items),
        _ => PosterRail(items: section.items),
      };

  @override
  Widget build(BuildContext context) {
    final state = context.watch<CatalogCubit>().state;
    final feed = state.feeds[widget.tab];
    final headerHeight =
        MediaQuery.paddingOf(context).top + _logoRowHeight + _tabRowHeight;
    Future<void> reload() =>
        context.read<CatalogCubit>().loadFeed(widget.tab, force: true);

    if (feed == null) {
      return Padding(
          padding: EdgeInsets.only(top: headerHeight),
          child: state.feedErrors.contains(widget.tab)
              ? Align(
                  alignment: Alignment.topCenter,
                  child: ErrorNotice(
                      message:
                          'NEXO could not load this page. Check your connection and retry.',
                      retry: reload))
              : const _FeedSkeleton());
    }
    if (feed.isEmpty) {
      return Padding(
          padding: EdgeInsets.only(top: headerHeight),
          child: EmptyState(
              icon: Icons.tv_off_outlined,
              title: 'Nothing to Show',
              body: 'Content for this section will appear here when available.',
              action:
                  TextButton(onPressed: reload, child: const Text('Retry'))));
    }
    return RefreshIndicator(
      color: kPink,
      edgeOffset: headerHeight,
      onRefresh: reload,
      child: ListView(
          controller: _controller,
          padding: EdgeInsets.zero,
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            if (feed.hero.isNotEmpty)
              _HeroCarousel(items: feed.hero)
            else
              SizedBox(height: headerHeight - 14),
            for (final section in feed.sections) ...[
              SectionHeader(
                  title: section.title,
                  onViewAll: section.viewAll == null
                      ? null
                      : () => context.push('/browse', extra: section.viewAll)),
              _rail(section),
            ],
            const RightsNote(),
            const SizedBox(height: 28),
          ]),
    );
  }
}

class _HeroCarousel extends StatefulWidget {
  const _HeroCarousel({required this.items});
  final List<CatalogItem> items;
  @override
  State<_HeroCarousel> createState() => _HeroCarouselState();
}

class _HeroCarouselState extends State<_HeroCarousel> {
  final _controller = PageController();
  Timer? _timer;
  int _page = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Auto-advance unless the viewer asked for reduced motion.
    _timer?.cancel();
    if (widget.items.length > 1 && !MediaQuery.disableAnimationsOf(context)) {
      _timer = Timer.periodic(const Duration(seconds: 7), (_) {
        if (!_controller.hasClients) return;
        _controller.animateToPage((_page + 1) % widget.items.length,
            duration: const Duration(milliseconds: 450), curve: Curves.easeOut);
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final height = math.min(MediaQuery.sizeOf(context).height * .7, 640.0);
    return SizedBox(
      height: height,
      child: Stack(children: [
        Positioned.fill(
            child: PageView.builder(
                controller: _controller,
                itemCount: widget.items.length,
                onPageChanged: (value) => setState(() => _page = value),
                itemBuilder: (context, index) =>
                    _HeroSlide(item: widget.items[index]))),
        Positioned(
            left: 0,
            right: 0,
            bottom: 6,
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (var index = 0; index < widget.items.length; index++)
                Container(
                    width: 7,
                    height: 7,
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: index == _page ? Colors.white : Colors.white30)),
            ])),
      ]),
    );
  }
}

class _HeroSlide extends StatelessWidget {
  const _HeroSlide({required this.item});
  final CatalogItem item;

  @override
  Widget build(BuildContext context) {
    final isVideo = item.type == 'video' || item.posterUrl == null;
    final meta = [
      if (item.type == 'video') item.category,
      if (item.genres.isNotEmpty) item.genres.first,
      if (item.type == 'series') 'Series',
      if (item.year != null) '${item.year}',
    ].join('  •  ');
    return GestureDetector(
      onTap: () => openItem(context, item),
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
              .22,
              .5,
              .86,
              1
            ],
                    colors: [
              Color(0x99000000),
              Color(0x00000000),
              Color(0x00111114),
              Color(0xF2111114),
              kBg
            ]))),
        Positioned(
            left: 18,
            right: 18,
            bottom: 34,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              if (isVideo)
                Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Text(item.name,
                        textAlign: TextAlign.center,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 24,
                            height: 1.15,
                            fontWeight: FontWeight.w800))),
              if (meta.isNotEmpty)
                Text(meta,
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w600)),
              const SizedBox(height: 14),
              PinkButton(
                  label: 'Watch Now',
                  icon: Icons.play_circle_fill,
                  onPressed: () => item.type == 'movie'
                      ? playItem(context, item)
                      : openItem(context, item)),
            ])),
      ]),
    );
  }
}

class _FeedSkeleton extends StatelessWidget {
  const _FeedSkeleton();
  @override
  Widget build(BuildContext context) => ListView(
          physics: const NeverScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Container(
                height: 300,
                decoration: BoxDecoration(
                    color: kPanel, borderRadius: BorderRadius.circular(6))),
            for (var row = 0; row < 2; row++) ...[
              const SizedBox(height: 30),
              Container(height: 18, width: 150, color: kPanel),
              const SizedBox(height: 14),
              Row(children: [
                for (var index = 0; index < 3; index++)
                  Expanded(
                      child: Container(
                          height: 160,
                          margin: const EdgeInsets.only(right: 8),
                          decoration: BoxDecoration(
                              color: kPanel,
                              borderRadius: BorderRadius.circular(4)))),
              ]),
            ],
          ]);
}
