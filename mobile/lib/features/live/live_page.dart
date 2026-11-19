import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../core/theme.dart';
import '../../domain/entities/catalog_item.dart';
import '../catalog/catalog_cubit.dart';
import '../shared/widgets.dart';

/// The full live channel directory with category filters.
class LivePage extends StatefulWidget {
  const LivePage({super.key});
  @override
  State<LivePage> createState() => _LivePageState();
}

class _LivePageState extends State<LivePage> {
  String _category = '';
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<CatalogCubit>().state;
    final query = _search.text.trim();
    final channels =
        filterChannels(state.channels, category: _category, query: query);
    return DecoratedBox(
      decoration: const BoxDecoration(gradient: kPageGradient),
      child: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const PageTitle('Live TV'),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
            child: TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              textInputAction: TextInputAction.search,
              style: const TextStyle(fontSize: 16),
              decoration: InputDecoration(
                hintText: 'Search channels',
                hintStyle: const TextStyle(color: kMuted),
                prefixIcon: const Icon(Icons.search, color: Colors.white70),
                suffixIcon: query.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Clear search',
                        onPressed: () => setState(_search.clear),
                        icon: const Icon(Icons.close)),
                filled: true,
                fillColor: const Color(0x33000000),
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
                enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(6),
                    borderSide: const BorderSide(color: Color(0x44FFFFFF))),
                focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(6),
                    borderSide: const BorderSide(color: kPink)),
              ),
            ),
          ),
          if (state.categories.isNotEmpty)
            FilterChips(
                labels: ['All', ...state.categories],
                selected: _category.isEmpty ? 'All' : _category,
                onSelected: (value) =>
                    setState(() => _category = value == 'All' ? '' : value)),
          const SizedBox(height: 8),
          Expanded(
              child: state.loading && state.channels.isEmpty
                  ? const Center(child: CircularProgressIndicator(color: kPink))
                  : state.error != null && state.channels.isEmpty
                      ? Align(
                          alignment: Alignment.topCenter,
                          child: ErrorNotice(
                              message: state.error!,
                              retry: () =>
                                  context.read<CatalogCubit>().refresh()))
                      : channels.isEmpty
                          ? EmptyState(
                              icon: query.isEmpty
                                  ? Icons.live_tv
                                  : Icons.search_off,
                              title: query.isEmpty
                                  ? 'No channels available'
                                  : 'No channels match "$query"',
                              body: query.isEmpty
                                  ? 'Live channels will appear here when they are added.'
                                  : 'Try another name, or pick All above.')
                          : RefreshIndicator(
                              color: kPink,
                              onRefresh: () =>
                                  context.read<CatalogCubit>().refresh(),
                              child: ChannelGrid(channels: channels))),
        ]),
      ),
    );
  }
}

/// Channels in [category] (all when empty) whose name, category or
/// description contains every word of [query]. Exported for tests.
List<CatalogItem> filterChannels(List<CatalogItem> channels,
    {String category = '', String query = ''}) {
  final words = query
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .toList();
  return channels.where((channel) {
    if (category.isNotEmpty && channel.category != category) return false;
    if (words.isEmpty) return true;
    final haystack =
        '${channel.name} ${channel.category} ${channel.synopsis}'.toLowerCase();
    return words.every(haystack.contains);
  }).toList();
}

class PageTitle extends StatelessWidget {
  const PageTitle(this.title, {super.key});
  final String title;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 14, 20, 14),
        child: Text(title,
            style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w700)),
      );
}

/// A horizontal row of outlined filter chips.
class FilterChips extends StatelessWidget {
  const FilterChips(
      {super.key,
      required this.labels,
      required this.onSelected,
      this.selected});
  final List<String> labels;
  final String? selected;
  final ValueChanged<String> onSelected;
  @override
  Widget build(BuildContext context) => SizedBox(
        height: 42,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          itemCount: labels.length,
          itemBuilder: (context, index) {
            final active = labels[index] == selected;
            return Material(
              color: active ? kPink : const Color(0x33000000),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(6),
                  side: BorderSide(
                      color: active ? kPink : const Color(0x33FFFFFF))),
              child: InkWell(
                onTap: () => onSelected(labels[index]),
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Center(
                      child: Text(labels[index],
                          style: const TextStyle(
                              fontSize: 15, fontWeight: FontWeight.w600))),
                ),
              ),
            );
          },
          separatorBuilder: (_, __) => const SizedBox(width: 8),
        ),
      );
}

class ChannelGrid extends StatelessWidget {
  const ChannelGrid({super.key, required this.channels});
  final List<CatalogItem> channels;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) {
          final columns = (constraints.maxWidth / 124).floor().clamp(3, 8);
          final size =
              (constraints.maxWidth - 32 - (columns - 1) * 14) / columns;
          return GridView.builder(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
            physics: const AlwaysScrollableScrollPhysics(),
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: columns,
                crossAxisSpacing: 14,
                mainAxisSpacing: 14,
                mainAxisExtent: size + 7 + textBlockHeight(context, 11) + 4),
            itemCount: channels.length,
            itemBuilder: (context, index) =>
                ChannelCircle(item: channels[index], size: size),
          );
        },
      );
}
