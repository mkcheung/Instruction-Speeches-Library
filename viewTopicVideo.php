<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("category.php");
require_once("topic.php");
require_once("notes.php");
require_once("function.php");
require_once("Session.php");
require_once("Post.php");
require_once("Video.php");
// include_once("header.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

$cid = $_GET['catId'];
$topId = $_GET['topId'];
$vidId = $_GET['vidId'];
$userId = $_SESSION['user_id'];

$speechVideo = Topic::find_by_id($topId);
$allRelatedPosts = Post::find_posts_by_category_and_topic($cid, $topId);

$category = Category::find_by_id($speechVideo->category_id);

$notes = Note::find_notes_by_topic_id($topId);

foreach($allRelatedPosts as $post){
	$poster[$post->post_creator] = User::find_by_id($post->post_creator);
}
?>

<div class="container-fluid">
 	<div class="row-fluid">
 		<div class="span2">		
 			<ul class="nav nav-list navMenu">
			 	<li class="nav-header">
			 		Toastmasters Library
			 	</li>
				<li>
					<a href="logout.php">Logout</a>
				</li>
				<li>
					<a href="index.php">Back To Main</a>
				</li>
			</ul>
 		</div>
    	<div class="span10 well well-large">
			<div id="videoSection">
				<div class="row-fluid">
					<div class="span1">
					</div>
					<div class="span10">
						<div id="videoAndNotes">
							<div id="vnFrame">
								<div id="theVideo">
									<video id="samp" width="640" height="480" controls>
									<source src = "../videos/<?=$speechVideo->video_name_1?>" type="<?=$speechVideo->video_type_1?>">
									<source src = "../videos/<?=$speechVideo->video_name_2?>" type="<?=$speechVideo->video_type_2?>">
										Your browser does not support this video format.
									</video>
								</div>
								<div id="theNotes" style="display:none">
								</div>
							</div>
						</div>
					</div>
					<div class="span1">
					</div>
				</div>
				<script>
				var pop = Popcorn("#samp");
				</script>
				<?php
					foreach($notes as $note){
						$begin = explode(':',$note->begin_time);
						$end = explode(':',$note->end_time);
						$begin = ($begin[0] * 60 * 60) + ($begin[1] * 60) + $begin[2];
						$end = ($end[0] * 60 * 60) + ($end[1] * 60) + $end[2];
				?>
					 <script>
						 pop.code({
						   start: <?=$begin?>,
						   end: <?=$end?>,
						   onStart: function(){
						   		$('#theNotes').html('<h2 align=\"center\">' + "<?=$note->title?>" + '</h2><div id="theNotes2" align="center">' + "<?=$note->note?>" + '</div>');
						   		$('#theNotes').fadeIn();
						   },
						   onEnd: function(){
						   		$('#theNotes').fadeOut();
						   }
						 });
					</script>
					 <script>
						 // pop.footnote({
						 //   start: <?=$begin?>,
						 //   end: <?=$end?>,
						 //   text: "<?=$note->note?>",
						 //   target: "theNotes2"
						 // });
					</script>
				<?php
					}
				?>
				<div id="topicDescription">
					<div id="topicPreamble">
						<h4><?=$speechVideo->topic_title?></h4></br>
						<?=$speechVideo->topic_date?></br>
						<?=$speechVideo->description?>
					</div>
					<div id="topicNavTemp">
						<h4>Navigator Placement</h4></br>
						test
					</div>
					<div id="topicCategoryInfo">
						<h4>Speech Category</h4></br>
						<?=$category->category_title?></br>
						<?=$category->category_description?></br>
					</div>	
				</div>
			</div>
			<section id="forumBlock">
				<div id="forumPosts">
					<h1>Speech Commentary</h1>
					<?php
						if(is_null($allRelatedPosts)){
					?>
						<b>No Posts For Video</b></br>
					<?php
						} else {
							foreach($allRelatedPosts as $relatedPost){
								$dtime = new DateTime($relatedPost->post_date);
					?>
								<div class="topicPosts">
								<div class="aboutPosts">
									Posted by: <?=$poster[$relatedPost->post_creator]->first_name . ' ' . $poster[$relatedPost->post_creator]->last_name . ' on ' . $dtime->format('F d, Y') . ' at ' . $dtime->format('g:i a')?>
								</div>
								</br>
								<div class="thePostContent">
									<?=nl2br($relatedPost->post_content)?>
								</div>
								</div>
					<?php
							}
						}
					?>
				</div>

				<div id="forumPostFormWrapper">
					<form id="forumPostForm" action="viewTopicVideo.php" method="post">
						<legend>New Post</legend>
						<textarea name="post_content" id="post_content"></textarea></br>
						<input type="hidden" name="category_id" id="category_id" value="<?=$cid?>"/></br>
						<input type="hidden" name="topic_id" id="topic_id" value="<?=$topId?>"/></br>
						<input type="hidden" name="post_creator" id="post_creator" value="<?=$userId?>"/></br>
						<input  type="hidden" id="submit2" name="submit"/>
						<input type="submit" name="submit" value="submit" class="btn btn-custom-pine-green"/>
					</form>
				</div>
				<script>
					$('#forumPostForm').submit(function(e){
						e.preventDefault();
						e.stopPropagation();
						formData = $('#forumPostForm').serialize();
						postValue = formData.substring(formData.indexOf('=')+1,formData.indexOf('&'));
						if(postValue.length > 0){
							$.ajax({
								type:'POST',
								url: 'topicPosts.php',
								data:formData,
								cache: false,
								timeout:7000,
								processData:true,
								success: function(data){
									allTopicPosts = $("<div>").html(data).find( 'div#allPosts' ).html();

									// alert(data);
									// allTopicPosts = $(data).filter('div#allPosts').html();
									// alert(allTopicPosts);
									$('div[class="alert alert-error"]').remove();
									$('div[class="alert alert-success"]').remove();
									$('div[class="alert alert-success"]').remove();
									$("#registerErrorMessages").append('<div class="alert alert-success">Success!</div>');
									$("#registerErrorMessages").removeAttr('style');
									$("#registerErrorMessages").fadeOut(2000);
									$("#forumPosts").html(allTopicPosts);
								},
								error: function(XMLHttpRequest, textStatus, errorThrown){
									$('div[class="alert alert-error"]').remove();
							$('div[class="alert alert-success"]').remove();
									$('div[class="alert alert-success"]').remove();
									$("#registerErrorMessages").append('<div class="alert alert-error">Ajax problems.</div>');
									$("#registerErrorMessages").removeAttr('style');
									$("#registerErrorMessages").fadeOut(2000);
								},
								complete: function(XMLHttpRequest, status){
									$('form[id="forumPostForm"]')[0].reset();
								}
							});
						} else {
							$('div[class="alert alert-error"]').remove();
							$('div[class="alert alert-success"]').remove();
							$('div[class="alert alert-success"]').remove();
							errorDisplay = '<div class="alert alert-error"><p> A posting is required. </p></div>';
							$('#registerErrorMessages').append(errorDisplay);
							$('#registerErrorMessages').removeAttr('style');
							$('#registerErrorMessages').fadeOut(2000);
						}
					});
				</script>
			</section>
		</div>
	</div>
</div>
<?php
include_once("footer.php");
?>

