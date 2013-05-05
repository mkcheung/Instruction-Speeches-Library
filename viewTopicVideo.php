<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("category.php");
require_once("topic.php");
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

foreach($allRelatedPosts as $post){
	$poster[$post->post_creator] = User::find_by_id($post->post_creator);
}
?>

<div class="container">
	<div id="videoSection">
		<?php
			echo "<div id=\"videoAndNotes\">";
				echo "<div id=\"theVideo\">";
					echo "<video width=\"640\" height=\"480\" controls>" ;
					echo "<source src=\"../videos/". $speechVideo->video_name . "\" type=\"" . $speechVideo->video_type ."\">";
					echo "</video>";
				echo "</div>";
				echo "<div id=\"theNotes\">";
					echo "<div id=\"test\"";
						echo "</br><a href=\"#\" id=\"element\" rel=\"tooltip\" data-placement=\"right\" data-original-title=\"first tooltip\">Vocal Intonations</a>";
					echo "</div>";
				echo "</div>";
			echo "</div>";

			echo "<div id=\"topicDescription\">";

				echo "<div id=\"topicPreamble\">";
					echo "<h4>" . $speechVideo->topic_title . "</h4></br>";
					echo $speechVideo->topic_date . " </br>";
					echo $speechVideo->description ;
				echo "</div>";
				echo "<div id=\"topicNavTemp\">";
					echo "<h4>Navigator Placement</h4></br>";
					echo "test";
				echo "</div>";
				echo "<div id=\"topicCategoryInfo\">";
					echo "<h4>Speech Category</h4></br>";
					echo $category->category_title . " </br>";
					echo $category->category_description . " </br>";
				echo "</div>";	
			echo "</div>";

		?>
	</div>
	<section id="forumBlock">
		<div id="forumPosts">
			<h1>Speech Commentary</h1>
			<?php
				if(is_null($allRelatedPosts)){
					echo "<b>No Posts For Video</b></br>";
				} else {
					foreach($allRelatedPosts as $relatedPost){
						$dtime = new DateTime($relatedPost->post_date);
						echo '<div class="topicPosts">';
						echo '<div class="aboutPosts">';
						echo 'Posted by: ' . $poster[$relatedPost->post_creator]->first_name . ' ' . $poster[$relatedPost->post_creator]->last_name . ' on ' . $dtime->format('F d, Y') . ' at ' . $dtime->format('g:i a');
						echo '</div>';
						echo '</br>';
						echo '<div class="thePostContent">';
						echo $relatedPost->post_content;
						echo '</div>';
						echo '</div>'; 
					}
				}
			?>
		</div>

		<div id="forumPostFormWrapper">
			<form id="forumPostForm" action="viewTopicVideo.php" method="post">
				<legend>New Post</legend>
				<textarea name="post_content" id="post_content"></textarea></br>
				<?php
					echo "<input type=\"hidden\" name=\"category_id\" id=\"category_id\" value=\"" . $cid . "\"/></br>";
					echo "<input type=\"hidden\" name=\"topic_id\" id=\"topic_id\" value=\"" . $topId . "\"/></br>";
					echo "<input type=\"hidden\" name=\"post_creator\" id=\"post_creator\" value=\"" . $userId . "\"/></br>";
				
					echo "<input  type=\"hidden\" id=\"submit2\" name=\"submit\"/>"
				?>
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
							alert(allTopicPosts);
							
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
<?php
include_once("footer.php");
?>